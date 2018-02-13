/*jslint node: true */
'use strict';
const desktopApp = require('byteballcore/desktop_app.js');
const conf = require('byteballcore/conf');

/**
 * responses for clients
 */
exports.greeting = () => {
	return [
			"Here you can attest your email.\n\n",

			"Your email will be saved privately in your wallet, " +
			"only a proof of attestation will be posted publicly on the distributed ledger. " +
			"The very fact of being attested may give you access to some services or tokens, even without disclosing your email. " +
			"Some apps may request you to reveal of your attested email, you choose what to reveal and to which app.\n\n",

			"You may also choose to make your attested email public.\n\n",

			"If you are a non-US citizen, we will offer you to attest this fact, this information is always public. " +
			"This is useful for participation in some ICOs which restrict access to their tokens only to non-US citizens.\n\n",

			`The price of attestation is ${conf.priceInBytes} Bytes. ` +
			"The payment is nonrefundable even if the attestation fails for any reason.\n\n",

			"After payment, you will be received email for the verification. You will need to click at the specified link.\n\n",

			`After you successfully verify yourself for the first time, you receive a ${conf.rewardInBytes} Bytes reward.`
		].join('');
};

exports.insertMyAddress = () => {
	return [
		"Please send me your address that you wish to attest (click ... and Insert my address). ",
		"Make sure you are in a single-address wallet. ",
		"If you don't have a single-address wallet, ",
		"please add one (burger menu, add wallet) and fund it with the amount sufficient to pay for the attestation."
	].join('');
};

/**
 * errors initialize bot
 */
exports.errorInitSql = () => {
	return "please import db.sql file\n";
};

exports.errorConfigSmtp = () => {
	return `please specify smtpUser, smtpPassword and smtpHost in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};

exports.errorConfigEmail = () => {
	return `please specify admin_email and from_email in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};

exports.errorConfigSalt = () => {
	return `please specify salt in your ${desktopApp.getAppDataDir()}/conf.json\n`;
};