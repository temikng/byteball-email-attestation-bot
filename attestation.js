/*jslint node: true */
'use strict';
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const validationUtils = require('byteballcore/validation_utils');
const headlessWallet = require('headless-byteball');
const texts = require('./modules/texts');

/**
 * user pairs his device with bot
 */
eventBus.on('paired', (from_address) => {
	respond(from_address, '', texts.greeting() + "\n\n");
});

eventBus.once('headless_wallet_ready', () => {
	let error = '';

	/**
	 * check if database tables is created
	 */
		// TODO: set all required table names
	let arrTableNames = ['users'];
	db.query("SELECT name FROM sqlite_master WHERE type='table' AND NAME IN (?)", [arrTableNames], (rows) => {
		if (rows.length !== arrTableNames.length) {
			error += texts.errorInitSql();
		}

		/**
		 * check if config is filled correct
		 */
		if (conf.useSmtp && (!conf.smtpUser)) {
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
			console.log('== real name attestation address: ' + address1);
			// realNameAttestation.assocAttestorAddresses['real name'] = address1;
			headlessWallet.issueOrSelectAddressByIndex(0, 1, (address2) => {
				console.log('== non-US attestation address: ' + address2);
				// realNameAttestation.assocAttestorAddresses['nonus'] = address2;
				headlessWallet.issueOrSelectAddressByIndex(0, 2, (address3) => {
					console.log('== distribution address: ' + address3);
					// reward.distribution_address = address3;

					// server.listen(conf.webPort);

					// setInterval(realNameAttestation.retryPostingAttestations, 10*1000);
					// setInterval(reward.retrySendingRewards, 10*1000);
					// setInterval(moveFundsToAttestorAddresses, 60*1000);
				});
			});
		});
	});
});

eventBus.on('text', (from_address, text) => {
	respond(from_address, text.trim(), '');
});

eventBus.on('new_my_transactions', function (arrUnits) {
	console.log('on:new_my_transactions', arguments);
});

eventBus.on('my_transactions_became_stable', function (arrUnits) {
	console.log('on:my_transactions_became_stable', arguments);
});

if (conf.bRunWitness) {
	require('byteball-witness');
	eventBus.emit('headless_wallet_ready');
} else {
	headlessWallet.setupChatEventHandlers();
}

function respond (from_address, text, response) {
	let device = require('byteballcore/device.js');
	readUserInfo(from_address, (userInfo) => {

		function checkUserAddress (onDone) {
			if (validationUtils.isValidAddress(text)) {
				userInfo.user_address = text;
				response += `Thanks, going to attest your address ${userInfo.user_address}. `;
				db.query('UPDATE users SET user_address=? WHERE device_address=?', [userInfo.user_address, from_address], () => {
					onDone();
				});
				return;
			}
			if (userInfo.user_address) {
				return onDone();
			}
			onDone(texts.insertMyAddress());
		}

		checkUserAddress((user_address_response) => {
			if (user_address_response) {
				return device.sendMessageToDevice(from_address, 'text', response + user_address_response);
			}

			// tmp
			if (!response) {
				response += 'unknown command';
			}
			device.sendMessageToDevice(from_address, 'text', response);

		});
	});
}

function readUserInfo (device_address, cb) {
	db.query('SELECT user_address FROM users WHERE device_address = ?', [device_address], (rows) => {
		if (rows.length) {
			cb(rows[0]);
		} else {
			db.query(`INSERT ${db.getIgnore()} INTO users (device_address) VALUES(?)`, [device_address], () => {
				cb({ device_address, user_address: null });
			});
		}
	});
}