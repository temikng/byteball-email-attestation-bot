/*jslint node: true */
'use strict';
const desktopApp = require('byteballcore/desktop_app.js');
const conf = require('byteballcore/conf');

/**
 * responses for clients
 */
exports.greeting = () => {
	return "Here you can attest your email.";
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