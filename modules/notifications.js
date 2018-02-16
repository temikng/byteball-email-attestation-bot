/*jslint node: true */
'use strict';
const conf = require('byteballcore/conf.js');
const mail = require('byteballcore/mail.js');
const nodemailer = require('nodemailer');

let transporter;

if (conf.bUseSmtp) {
	const port = conf.smtpPort ? Number(conf.smtpPort) : 465;
	const transporterOptions = {
		host: conf.smtpHost,
		port,
		secure: port === 465, // true for 465, false for other ports
		auth: {
			user: conf.smtpUser,
			pass: conf.smtpPassword
		}
	};
	transporter = nodemailer.createTransport(transporterOptions);
}

function notifyEmail (email, nameTo, subject, body, callback) {
	if (!callback) callback = function () {};
	console.log(`notifyEmail:\n${email}\n${subject}\n${body}`);
	if (conf.bUseSmtp) {
		const dataMail = {
			from: `${conf.from_email_name?conf.from_email_name+' ':''}<${conf.from_email}>`,
			to: `${nameTo?nameTo+' ':''}<${email}>`,
			subject: subject,
			text: body,
			html: body
		};
		transporter.sendMail(dataMail, (err, info) => {
			if (err) {
				return callback(err);
			}
			callback(null, info);
		});
	} else {
		mail.sendmail({
			from: conf.from_email,
			to: email,
			subject: subject,
			body: body
		}, callback);
	}
}

function notifyAdmin (subject, body, callback) {
	notifyEmail(conf.admin_email, 'You', subject, body, callback);
}

module.exports = {
	notifyEmail,
	notifyAdmin
};