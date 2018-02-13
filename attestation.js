/*jslint node: true */
'use strict';
const conf = require('byteballcore/conf');
const db = require('byteballcore/db');
const eventBus = require('byteballcore/event_bus');
const headlessWallet = require('headless-byteball');
const texts = require('./modules/texts');

/**
 * user pairs his device with bot
 */
eventBus.on('paired', function (from_address) {
	console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! on:paired', arguments);
});

eventBus.once('headless_wallet_ready', () => {
	let error = '';

	/**
	 * check if database tables is created
	 */
	let arrTableNames = ['bots'];
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

eventBus.on('text', function (from_address, text) {
	console.log('on:text', arguments);
	const device = require('byteballcore/device');
	device.sendMessageToDevice(from_address, 'text', "test message to device");
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