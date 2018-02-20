/*jslint node: true */
'use strict';
const crypto = require('crypto');

function generateRandomCryptoStringByLengthSync(lenOfStr) {
	if (lenOfStr < 1) throw new Error('the string must contain minimum 1 letter or more');
	let buf = crypto.randomBytes(Math.ceil(5 / 2));
	let strHex = buf.toString('hex');
	if (strHex.length === lenOfStr) {
		return strHex;
	} else {
		return strHex.substring(0, lenOfStr);
	}
}

function generateRandomCryptoStringByLengthAsync(lenOfStr) {
	return new Promise((resolve, reject) => {
		generateRandomCryptoStringByLength(lenOfStr, (err, strResult) => {
			if (err) return reject(err);
			resolve(strResult);
		});
	});
}

function generateRandomCryptoStringByLength(lenOfStr, cb) {
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

module.exports = {
	generateByLengthSync: generateRandomCryptoStringByLengthSync,
	generateByLengthAsync: generateRandomCryptoStringByLengthAsync,
	generateByLength: generateRandomCryptoStringByLength
};