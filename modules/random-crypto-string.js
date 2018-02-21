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

module.exports = {
	generateByLengthSync: generateRandomCryptoStringByLengthSync
};