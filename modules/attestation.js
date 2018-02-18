/*jslint node: true */
'use strict';
const conf = require('byteballcore/conf');
const objectHash = require('byteballcore/object_hash.js');
const db = require('byteballcore/db');
const notifications = require('./notifications');

function retryPostingAttestations(callbackRowAttestation) {
	db.query(
		`SELECT 
			t.transaction_id, 
			ra.user_email, ra.post_publicly, ra.user_address
		FROM attestation_units au
		JOIN transactions t ON t.transaction_id = au.transaction_id
		JOIN receiving_addresses ra ON ra.receiving_address = t.receiving_address
		WHERE au.attestation_unit IS NULL`,
		(rows) => {
			rows.forEach((row) => {
				let	[attestation, src_profile] = getAttestationPayloadAndSrcProfile(row.user_address, row.user_email, row.post_publicly);
				// console.error('retryPostingAttestations: ' + row.transaction_id + ' ' + row.post_publicly);
				// console.error(attestation);
				// console.error(src_profile);
				postAndWriteAttestation(row.transaction_id, exports.emailAttestorAddress, attestation, src_profile, (err, unit) => {
					if (err) {
						return callbackRowAttestation(err);
					}
					callbackRowAttestation(null, row.transaction_id, row.user_address, unit);
				});
			});
		}
	);
}

function postAndWriteAttestation(transaction_id, attestor_address, attestation_payload, src_profile, callback) {
	if (!callback) callback = function () {};
	const mutex = require('byteballcore/mutex.js');
	mutex.lock(['tx-'+transaction_id], (unlock) => {
		db.query(
			`SELECT ra.device_address, au.attestation_date
			FROM attestation_units au
			JOIN transactions t ON t.transaction_id = au.transaction_id
			JOIN receiving_addresses ra ON ra.receiving_address = t.receiving_address
			WHERE t.transaction_id=?`,
			[transaction_id],
			(rows) => {
				let row = rows[0];
				if (row.attestation_date) { // already posted
					callback(null, null);
					return unlock();
				}

				postAttestation(attestor_address, attestation_payload, (err, unit) => {
					if (err) {
						callback(err);
						return unlock();
					}

					db.query(
						`UPDATE attestation_units 
						SET attestation_unit=?, attestation_date=${db.getNow()} 
						WHERE transaction_id=?`,
						[unit, transaction_id],
						() => {
							let device = require('byteballcore/device.js');
							let text = "Now your email is attested, see the attestation unit: https://explorer.byteball.org/#"+unit;

							if (src_profile) {
								let private_profile = {
									unit: unit,
									payload_hash: objectHash.getBase64Hash(attestation_payload),
									src_profile: src_profile
								};
								let base64PrivateProfile = Buffer.from(JSON.stringify(private_profile)).toString('base64');
								text += "\n\nClick here to save the profile in your wallet: [private profile](profile:"+base64PrivateProfile+"). " +
									"You will be able to use it to access the services that require a proven identity.";
							}

							text += "\n\nRemember, we have a referral program: " +
								"if you send Bytes from your attested address to a new user who is not attested yet, " +
								"and he/she uses those Bytes to pay for a successful attestation, " +
								"you receive a "+conf.referralRewardInBytes+" Bytes reward.";
							device.sendMessageToDevice(row.device_address, 'text', text);
							callback(null, unit);
							unlock();
						}
					);
				});
			}
		);
	});
}

function postAttestation(attestor_address, payload, onDone) {
	function onError(err) {
		console.error("attestation failed: " + err);
		let balances = require('byteballcore/balances');
		balances.readBalance(attestor_address, (balance) => {
			console.error(balance);
			notifications.notifyAdmin('attestation failed', err + ", balance: " + JSON.stringify(balance));
		});
		onDone(err);
	}

	let network = require('byteballcore/network.js');
	let composer = require('byteballcore/composer.js');
	let headlessWallet = require('headless-byteball');
	let objMessage = {
		app: "attestation",
		payload_location: "inline",
		payload_hash: objectHash.getBase64Hash(payload),
		payload: payload
	};

	let params = {
		paying_addresses: [attestor_address],
		outputs: [{address: attestor_address, amount: 0}],
		messages: [objMessage],
		signer: headlessWallet.signer,
		callbacks: composer.getSavingCallbacks({
			ifNotEnoughFunds: onError,
			ifError: onError,
			ifOk: (objJoint) => {
				// console.error('ifOk');
				// console.error(objJoint);
				network.broadcastJoint(objJoint);
				onDone(null, objJoint.unit.unit);
			}
		})
	};
	if (conf.bPostTimestamp && attestor_address === exports.emailAttestorAddress) {
		let timestamp = Date.now();
		let dataFeed = {timestamp};
		let objTimestampMessage = {
			app: "data_feed",
			payload_location: "inline",
			payload_hash: objectHash.getBase64Hash(dataFeed),
			payload: dataFeed
		};
		params.messages.push(objTimestampMessage);
	}
	composer.composeJoint(params);
}

function getUserId(profile){
	let shortProfile = {
		email: profile.email
	};
	return objectHash.getBase64Hash([shortProfile, conf.salt]);
}

function getAttestationPayloadAndSrcProfile(user_address, email, bPublic) {
	let profile = {
		email
	};
	if (bPublic) {
		//	throw "public";
		profile.user_id = getUserId(profile);
		let attestation = {
			address: user_address,
			profile: profile
		};
		return [attestation, null];
	}  else {
		let [public_profile, src_profile] = hideProfile(profile);
		let attestation = {
			address: user_address,
			profile: public_profile
		};
		return [attestation, src_profile];
	}
}

function hideProfile(profile) {
	let composer = require('byteballcore/composer.js');
	let hidden_profile = {};
	let src_profile = {};

	for (let field in profile) {
		if (!profile.hasOwnProperty(field)) continue;
		let value = profile[field];
		let blinding = composer.generateBlinding();
		// console.error(`hideProfile: ${field}, ${value}, ${blinding}`);
		let hidden_value = objectHash.getBase64Hash([value, blinding]);
		hidden_profile[field] = hidden_value;
		src_profile[field] = [value, blinding];
	}
	let profile_hash = objectHash.getBase64Hash(hidden_profile);
	let user_id = getUserId(profile);
	let public_profile = {
		profile_hash: profile_hash,
		user_id: user_id
	};
	return [public_profile, src_profile];
}

exports.emailAttestorAddress = null;
exports.getAttestationPayloadAndSrcProfile = getAttestationPayloadAndSrcProfile;
exports.postAndWriteAttestation = postAndWriteAttestation;
exports.retryPostingAttestations = retryPostingAttestations;