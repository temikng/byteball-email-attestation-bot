/*jslint node: true */
'use strict';
const crypto = require('crypto');
const constants = require('byteballcore/constants.js');
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const mail = require('byteballcore/mail');
const headlessWallet = require('headless-byteball');
const texts = require('./modules/texts');
const reward = require('./modules/reward');
const emailAttestation = require('./modules/attestation');
const notifications = require('./modules/notifications');

/**
 * user pairs his device with bot
 */
eventBus.on('paired', (from_address) => {
	respond(from_address, '', texts.greeting());
});

/**
 * user sends message to the bot
 */
eventBus.on('text', (from_address, text) => {
	respond(from_address, text.trim());
});

/**
 * user pays to the bot
 */
eventBus.on('new_my_transactions', handleNewTransactions);

/**
 * pay is confirmed
 */
eventBus.on('my_transactions_became_stable', handleTransactionsBecameStable);

/**
 * ready headless wallet
 */
eventBus.once('headless_wallet_ready', handleWalletReady);

if (conf.bRunWitness) {
	require('byteball-witness');
	eventBus.emit('headless_wallet_ready');
} else {
	headlessWallet.setupChatEventHandlers();
}

function handleWalletReady() {
	let error = '';

	/**
	 * check if database tables is created
	 */
	let arrTableNames = [
		'users','receiving_addresses','transactions','verification_emails','attestation_units','rejected_payments',
		'reward_units','referral_reward_units'
	];
	db.query("SELECT name FROM sqlite_master WHERE type='table' AND NAME IN (?)", [arrTableNames], (rows) => {
		if (rows.length !== arrTableNames.length) {
			error += texts.errorInitSql();
		}

		/**
		 * check if config is filled correct
		 */
		if (conf.bUseSmtp && (!conf.smtpHost || !conf.smtpUser || !conf.smtpPassword)) {
			error += texts.errorConfigSmtp();
		}
		if (!conf.admin_email || !conf.from_email) {
			error += texts.errorConfigEmail();
		}
		if (!conf.salt) {
			error += texts.errorConfigSalt();
		}

		if (error) {
			throw new Error(error);
		}

		headlessWallet.issueOrSelectAddressByIndex(0, 0, (address1) => {
			console.log('== email attestation address: ' + address1);
			emailAttestation.emailAttestorAddress = address1;
			reward.distributionAddress = address1;

			// headlessWallet.issueOrSelectAddressByIndex(0, 1, (address2) => {
			// 	console.log('== distribution address: ' + address2);
			// 	reward.distributionAddress = address2;

				setInterval(retryPostingAttestations, 10*1000);
				setInterval(reward.retrySendingRewards, 10*1000);
				setInterval(retrySendingEmails, 60*1000);
				setInterval(moveFundsToAttestorAddresses, 60*1000);
			// });
		});
	});
}

function moveFundsToAttestorAddresses() {
	let network = require('byteballcore/network.js');
	if (network.isCatchingUp())
		return;

	console.log('moveFundsToAttestorAddresses');
	db.query(
		`SELECT DISTINCT receiving_address
		FROM receiving_addresses 
		CROSS JOIN outputs ON receiving_address=address 
		JOIN units USING(unit)
		WHERE is_stable=1 AND is_spent=0 AND asset IS NULL
		LIMIT ?`,
		[constants.MAX_AUTHORS_PER_UNIT],
		(rows) => {
			// console.error('moveFundsToAttestorAddresses', rows);
			if (rows.length === 0) {
				return;
			}

			let arrAddresses = rows.map(row => row.receiving_address);
			// console.error(arrAddresses, emailAttestation.emailAttestorAddress);
			let headlessWallet = require('headless-byteball');
			headlessWallet.sendMultiPayment({
				asset: null,
				to_address: emailAttestation.emailAttestorAddress,
				send_all: true,
				paying_addresses: arrAddresses
			}, (err, unit) => {
				if (err) {
					console.error("failed to move funds: " + err);
					let balances = require('byteballcore/balances');
					balances.readBalance(arrAddresses[0], (balance) => {
						console.error(balance);
						notifications.notifyAdmin('failed to move funds', err + ", balance: " + JSON.stringify(balance));
					});
				} else
					console.log("moved funds, unit " + unit);
			});
		}
	);
}

function retryPostingAttestations() {
	let device = require('byteballcore/device.js');
	emailAttestation.retryPostingAttestations((err, transaction_id, user_address, unit) => {
		if (err) return;

		// console.error('retryPostingAttestationsRow');
		// console.error(transaction_id, unit);

		if (!unit) return; // already posted

		db.query(
			`SELECT
				COUNT(*) AS count
			FROM receiving_addresses ra
			JOIN transactions t ON t.receiving_address = ra.receiving_address
			LEFT JOIN verification_emails ve ON ve.transaction_id = t.transaction_id AND ve.user_email = ra.user_email
			LEFT JOIN attestation_units au ON au.transaction_id = t.transaction_id
			WHERE ra.user_address = ? AND ve.result = 1 AND au.attestation_unit IS NOT NULL`,
			[user_address],
			(rows) => {
				let row = rows[0];
				// console.error('row.count: ' + row.count);
				if (row.count > 1) return; // this is not first time

				db.query(
					`SELECT
						ra.user_email, ra.post_publicly, ra.device_address, 
						t.payment_unit
					FROM receiving_addresses ra
					JOIN transactions t ON t.receiving_address = ra.receiving_address
					WHERE t.transaction_id=? AND ra.user_address=?`,
					[transaction_id, user_address],
					(rows) => {
						let row = rows[0];

						let [attestationPayload, src_profile] = emailAttestation.getAttestationPayloadAndSrcProfile(user_address, row.user_email, row.post_publicly);

						if (conf.rewardInBytes) {
							let rewardInBytes = conf.rewardInBytes;
							db.query(
								`INSERT ${db.getIgnore()} INTO reward_units
								(transaction_id, user_address, user_id, reward)
								VALUES (?,?,?,?)`,
								[transaction_id, user_address, attestationPayload.profile.user_id, rewardInBytes],
								(res) => {
									// console.error(`reward_units insertId: ${res.insertId}, affectedRows: ${res.affectedRows}`);
									if (!res.affectedRows) {
										return console.log(`duplicate user_address or user_id: ${user_address}, ${attestationPayload.profile.user_id}`);
									}

									device.sendMessageToDevice(row.device_address, 'text', texts.attestedSuccessFirstTimeBonus(rewardInBytes));
									reward.sendAndWriteReward('attestation', transaction_id);

									if (conf.referralRewardInBytes) {
										let referralRewardInBytes = conf.referralRewardInBytes;
										reward.findReferral(row.payment_unit, (referring_user_id, referring_user_address, referring_user_device_address) => {
											if (!referring_user_address) {
												// console.error("no referring user for " + user_address);
												return console.log("no referring user for " + user_address);
											}

											db.query(
												`INSERT ${db.getIgnore()} INTO referral_reward_units
												(transaction_id, user_address, user_id, new_user_address, new_user_id, reward)
												VALUES (?, ?,?, ?,?, ?)`,
												[transaction_id,
													referring_user_address, referring_user_id,
													user_address, attestationPayload.profile.user_id,
													referralRewardInBytes],
												(res) => {
													console.log(`referral_reward_units insertId: ${res.insertId}, affectedRows: ${res.affectedRows}`);
													if (!res.affectedRows) {
														return notifications.notifyAdmin(
															"duplicate referral reward",
															`referral reward for new user ${user_address} ${attestationPayload.profile.user_id} already written`
														);
													}

													device.sendMessageToDevice(referring_user_device_address, 'text', `You referred a user who has just verified his identity and you will receive a reward of ${conf.referralRewardInBytes} Bytes from Byteball distribution fund. Thank you for bringing in a new byteballer, the value of the ecosystem grows with each new user!`);
													reward.sendAndWriteReward('referral', transaction_id);
												}
											);
										});
									}
								}
							);
						}

					}
				);

			}
		);

	});
}

function retrySendingEmails() {
	db.query(
		`SELECT 
			ve.code, ve.user_email, ve.transaction_id,
			ra.device_address
		FROM verification_emails ve
		JOIN transactions t ON t.transaction_id = ve.transaction_id
		JOIN receiving_addresses ra ON ra.receiving_address = t.receiving_address AND ra.user_email = ve.user_email
		WHERE ve.is_sent = 0 AND ve.result IS NULL
		ORDER BY ve.creation_date ASC`,
		(rows) => {
			rows.forEach((row) => {
				notifyByEmailAndMarkIsSent(row.user_email, row.code, row.transaction_id, row.device_address);
			});
		}
	);
}

function handleNewTransactions(arrUnits) {
	let device = require('byteballcore/device.js');
	db.query(
		`SELECT
			o.amount, o.asset, o.unit,
			ra.receiving_address, ra.device_address, ra.user_address, ra.price, 
			${db.getUnixTimestamp('ra.last_price_date')} AS price_ts
		FROM outputs o
		CROSS JOIN receiving_addresses ra ON ra.receiving_address=o.address
		WHERE o.unit IN(?)
			AND NOT EXISTS (
				SELECT 1
				FROM unit_authors ua
				CROSS JOIN my_addresses ma ON ma.address=ua.address
				WHERE ua.unit=o.unit
			)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {
				checkPayment(row, (error, delay) => {
					if (error) {
						return db.query(
							`INSERT ${db.getIgnore()} INTO rejected_payments
							(receiving_address, price, received_amount, delay, payment_unit, error)
							VALUES (?,?,?,?,?,?)`,
							[row.receiving_address, row.price, row.amount, delay, row.unit, error],
							() => {
								device.sendMessageToDevice(row.device_address, 'text', error);
							}
						);
					}

					db.query(
						`INSERT INTO transactions
						(receiving_address, price, received_amount, payment_unit)
						VALUES (?,?,?,?)`,
						[row.receiving_address, row.price, row.amount, row.unit],
						() => {
							device.sendMessageToDevice(row.device_address, 'text', texts.receivedYourPayment(row.amount));
						}
					);
				});
			});
		}
	);
}

function checkPayment(row, onDone) {
	let delay = Math.round(Date.now()/1000 - row.price_ts);
	let bLate = (delay > conf.PRICE_TIMEOUT);
	if (row.asset !== null) {
		return onDone("Received payment in wrong asset", delay);
	}
	let current_price = conf.priceInBytes;
	let expected_amount = bLate ? current_price : row.price;
	if (row.amount < expected_amount) {
		//updatePrice(row.device_address, current_price);
		let text = `Received ${row.amount} Bytes from you`;
		text += bLate
			? ". Your payment is too late and less than the current price."
			: `, which is less than the expected ${row.price} Bytes.`;
		return onDone(text + '\n\n' + texts.pleasePay(row.receiving_address, current_price), delay);
	}

	db.query("SELECT address FROM unit_authors WHERE unit=?", [row.unit], (author_rows) => {
		if (author_rows.length !== 1) {
			return onDone(
				texts.receivedPaymentFromMultipleAddresses() + '\n\n' + texts.pleasePay(row.receiving_address, current_price),
				delay
			);
		}
		if (author_rows[0].address !== row.user_address) {
			return onDone(
				texts.receivedPaymentNotFromExpectedAddress(row.user_address) + `\n\n` + texts.pleasePay(row.receiving_address, current_price),
				delay
			);
		}
		onDone();
	});
}

function handleTransactionsBecameStable(arrUnits) {
	let device = require('byteballcore/device.js');
	db.query(
		`SELECT 
			t.transaction_id, 
			ra.device_address, ra.user_address, ra.user_email
		FROM transactions t
		JOIN receiving_addresses ra ON ra.receiving_address = t.receiving_address
		WHERE t.payment_unit IN(?)`,
		[arrUnits],
		(rows) => {
			rows.forEach((row) => {
				db.query(
					`UPDATE transactions 
					SET confirmation_date=${db.getNow()}, is_confirmed=1 
					WHERE transaction_id=?`,
					[row.transaction_id],
					() => {
						device.sendMessageToDevice(row.device_address, 'text', texts.paymentIsConfirmed());

						/**
						 * create and send verification code to attestation email
						 */
						randomCryptoString(6, (err, verificationCode) => {
							if (err) {
								return notifications.notifyAdmin('random crypto string', err);
							}

							db.query(
								`INSERT INTO verification_emails 
							(transaction_id, user_email, code) 
							VALUES(?,?,?)`,
								[row.transaction_id, row.user_email, verificationCode],
								() => {
									notifyByEmailAndMarkIsSent(row.user_email, verificationCode, row.transaction_id, row.device_address);
								}
							);
						});
					}
				);
			});
		}
	);
}

function randomCryptoString(lenOfStr, cb) {
	if (lenOfStr < 1) throw new Error('the string must contain minimum 1 letter or more');
	crypto.randomBytes(Math.ceil(5 / 2), (err, buf) => {
		if (err) return cb(err);
		let strHex = buf.toString('hex');
		if (strHex.length === lenOfStr) {
			cb(null, strHex);
		} else {
			cb(null, strHex.substring(0, lenOfStr));
		}
	});
}

function notifyByEmailAndMarkIsSent(user_email, code, transaction_id, device_address) {
	let device = require('byteballcore/device.js');
	mail.sendmail({
		from: `${conf.from_email_name ? conf.from_email_name + ' ' : ''}<${conf.from_email}>`,
		to: user_email,
		subject: texts.emailSubjectEmailAttestation(),
		text: texts.emailPlainBodyEmailAttestation(code),
		html: texts.emailBodyEmailAttestation(code)
	}, (err) => {
		if (err) {
			console.error(err);
			return notifications.notifyAdmin('failed to send mail', `failed to send mail to ${user_email}: ${err}`);
		}

		db.query(
			`UPDATE verification_emails 
			SET is_sent=?
			WHERE transaction_id=? AND user_email=?`,
			[1, transaction_id, user_email],
			() => {
				device.sendMessageToDevice(device_address, 'text', texts.emailWasSent(user_email));
			}
		);
	});
}

/**
 * scenario for responding to user requests
 * @param from_address
 * @param text
 * @param response
 */
function respond (from_address, text, response = '') {
	let device = require('byteballcore/device.js');
	readUserInfo(from_address, (userInfo) => {

		function checkUserAddress(onDone) {
			if (validationUtils.isValidAddress(text)) {
				userInfo.user_address = text;
				response += texts.goingAttestAddress(userInfo.user_address);
				return db.query(
					'UPDATE users SET user_address=? WHERE device_address=?',
					[userInfo.user_address, from_address],
					() => {
						onDone();
					}
				);
			}
			if (userInfo.user_address) return onDone();
			onDone(texts.insertMyAddress());
		}

		function checkUserEmail(onDone) {
			if (validationUtils.isValidEmail(text)) {
				userInfo.user_email = text;
				response += texts.goingAttestEmail(userInfo.user_email);
				return db.query(
					'UPDATE users SET user_email=? WHERE device_address=? AND user_address=?',
					[userInfo.user_email, from_address, userInfo.user_address],
					() => {
						onDone();
					}
				);
			}
			if (userInfo.user_email) return onDone();
			onDone(texts.insertMyEmail());
		}

		checkUserAddress((userAddressResponse) => {
			if (userAddressResponse) {
				return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + userAddressResponse);
			}

			checkUserEmail((userEmailResponse) => {
				if (userEmailResponse) {
					return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + userEmailResponse);
				}

				readOrAssignReceivingAddress(from_address, userInfo, (receiving_address, post_publicly) => {
					let price = conf.priceInBytes;

					if (text === 'private' || text === 'public') {
						post_publicly = (text === 'public') ? 1 : 0;
						db.query(
							`UPDATE receiving_addresses 
							SET post_publicly=? 
							WHERE device_address=? AND user_address=? AND user_email=?`,
							[post_publicly, from_address, userInfo.user_address, userInfo.user_email]
						);
						response += (text === "private") ? texts.privateChoose() : texts.publicChoose();
					}

					if (post_publicly === null) {
						return device.sendMessageToDevice(from_address, 'text', (response ? response + '\n\n' : '') + texts.privateOrPublic());
					}

					if (text === 'again') {
						return device.sendMessageToDevice(
							from_address,
							'text',
							(response ? response + '\n\n' : '') + texts.pleasePayOrPrivacy(receiving_address, price, post_publicly)
						);
					}

					db.query(
						`SELECT
							ve.code, ve.result, ve.number_of_attempts, 
							t.transaction_id, t.is_confirmed, t.received_amount,
							au.attestation_date, ra.user_address
						FROM transactions t
						JOIN receiving_addresses ra ON ra.receiving_address = t.receiving_address
						LEFT JOIN verification_emails ve ON ve.transaction_id = t.transaction_id AND ve.user_email = ra.user_email
						LEFT JOIN attestation_units au ON au.transaction_id = t.transaction_id
						WHERE t.receiving_address=?
						ORDER BY t.transaction_id DESC
						LIMIT 1`,
						[receiving_address],
						(rows) => {
							/**
							 * if user didn't pay yet
							 */
							if (rows.length === 0) {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + texts.pleasePayOrPrivacy(receiving_address, price, post_publicly));
							}

							let row = rows[0];
							let transaction_id = row.transaction_id;

							/**
							 * if user payed, but transaction did not become stable
							 */
							if (row.is_confirmed === 0) {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + texts.receivedYourPayment(row.received_amount));
							}

							let verification_email_result = row.result;
							/**
							 * if user still did not enter correct verification code
							 */
							if (verification_email_result === null) {

								if (text === row.code) {

									return db.query(
										`UPDATE verification_emails 
										SET result=?, result_date=${db.getNow()}
										WHERE transaction_id=? AND user_email=?`,
										[1, transaction_id, userInfo.user_email],
										() => {

											db.query(
												`INSERT ${db.getIgnore()} INTO attestation_units 
												(transaction_id) 
												VALUES (?)`,
												[transaction_id],
												() => {

													device.sendMessageToDevice(
														from_address,
														'text',
														(response ? response + '\n\n' : '') + texts.codeConfirmedEmailInAttestation(userInfo.user_email),
													);
												}
											);

										}
									);
								} else if (text === 'send email again') {
									/**
									 * user wants to receive email again
									 */
									return db.query(
										`UPDATE verification_emails 
										SET is_sent=?
										WHERE transaction_id=? AND user_email=?`,
										[0, row.transaction_id, userInfo.user_email],
										() => {
											notifyByEmailAndMarkIsSent(userInfo.user_email, row.code, row.transaction_id, from_address);
										}
									);
								} else {
									/**
									 * user enters wrong verification code
									 */
									let currNumberAttempts = Number(row.number_of_attempts) + 1;
									let leftNumberAttempts = conf.MAX_ATTEMPTS - currNumberAttempts;
									if (leftNumberAttempts > 0) {
										db.query(
											`UPDATE verification_emails 
											SET number_of_attempts=? 
											WHERE transaction_id=? AND user_email=?`,
											[currNumberAttempts, row.transaction_id, userInfo.user_email]
										);
									} else {
										db.query(
											`UPDATE verification_emails 
											SET number_of_attempts=?, result=?, result_date=${db.getNow()}
											WHERE transaction_id=? AND user_email=?`,
											[currNumberAttempts, 0, row.transaction_id, userInfo.user_email]
										);
									}
									response = (response ? response + '\n\n' : '') + texts.wrongVerificationCode(leftNumberAttempts);

									/**
									 * no more chance, attestation is failed
									 */
									if (leftNumberAttempts === 0) {
										return device.sendMessageToDevice(
											from_address,
											'text',
											(response ? response + '\n\n' : '') + texts.currentAttestationFailed()
										);
									}
								}

								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + texts.emailWasSent(userInfo.user_email)
								);
							}

							/**
							 * previous attestation was failed
							 */
							if (verification_email_result === 0) {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + texts.previousAttestationFailed()
								);
							}

							/**
							 * email is in attestation
							 */
							if (!row.attestation_date) {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + texts.codeConfirmedEmailInAttestation(userInfo.user_email)
								);
							}

							if (text === 'req') {
								return device.sendMessageToDevice(
									from_address,
									'text',
									(response ? response + '\n\n' : '') + "test req [req](profile-request:email)");
							}

							/**
							 * no more available commands, user email is attested
							 */
							return device.sendMessageToDevice(
								from_address,
								'text',
								(response ? response + '\n\n' : '') + texts.alreadyAttested(row.attestation_date)
							);
						}
					);
				});
			});
		});
	});
}

/**
 * get user's information by device address
 * or create new user, if it's new device address
 * @param device_address
 * @param callback
 */
function readUserInfo (device_address, callback) {
	db.query('SELECT user_address, user_email FROM users WHERE device_address = ?', [device_address], (rows) => {
		if (rows.length) {
			callback(rows[0]);
		} else {
			db.query(`INSERT ${db.getIgnore()} INTO users (device_address) VALUES(?)`, [device_address], () => {
				callback({ device_address, user_address: null });
			});
		}
	});
}

/**
 * read or assign receiving address
 * @param device_address
 * @param userInfo
 * @param callback
 */
function readOrAssignReceivingAddress(device_address, userInfo, callback) {
	const mutex = require('byteballcore/mutex.js');
	mutex.lock([device_address], (unlock) => {
		db.query(
			`SELECT receiving_address, post_publicly, ${db.getUnixTimestamp('last_price_date')} AS price_ts
			FROM receiving_addresses 
			WHERE device_address=? AND user_address=? AND user_email=?`,
			[device_address, userInfo.user_address, userInfo.user_email],
			(rows) => {
				if (rows.length > 0) {
					let row = rows[0];
					callback(row.receiving_address, row.post_publicly);
					return unlock();
				}

				headlessWallet.issueNextMainAddress((receiving_address) => {
					db.query(
						`INSERT INTO receiving_addresses 
						(device_address, user_address, user_email, receiving_address, price, last_price_date) 
						VALUES(?,?,?,?,?,${db.getNow()})`,
						[device_address, userInfo.user_address, userInfo.user_email, receiving_address, conf.priceInBytes],
						() => {
							callback(receiving_address, null);
							unlock();
						}
					);
				});
			}
		);
	});
}