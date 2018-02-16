/*jslint node: true */
"use strict";
exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
//exports.bLight = false;
exports.bLight = true;

exports.storage = 'sqlite';

// TOR is recommended. If you don't run TOR, please comment the next two lines
//exports.socksHost = '127.0.0.1';
//exports.socksPort = 9050;

exports.hub = 'byteball.org/bb-test';
exports.deviceName = 'Email attestation bot';
exports.permanent_pairing_secret = '0000';
exports.control_addresses = [''];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = false;
exports.bStaticChangeAddress = true;
exports.KEYS_FILENAME = 'keys.json';

// smtp
// exports.bUseSmtp = false;
exports.bUseSmtp = true;
exports.smtpHost = 'mail2.inevm.ru';
exports.smtpUser = 'fgistp@inevm.ru';
exports.smtpPort = 25;
exports.smtpPassword = "\"[0kjrfwbZ";

// emails
exports.admin_email = '';
exports.from_email = '';
exports.from_email_name = 'Byteball email attestation bot';

// witnessing
exports.bRunWitness = false;
exports.THRESHOLD_DISTANCE = 20;
exports.MIN_AVAILABLE_WITNESSINGS = 100;

exports.PRICE_TIMEOUT = 3600; // in seconds
exports.priceInBytes = 100;
exports.rewardInBytes = 200;
exports.referralRewardInBytes = 200;

exports.LIMIT_NUMBER_OF_CHECKING_EMAIL_ATTEMPTS = 5;