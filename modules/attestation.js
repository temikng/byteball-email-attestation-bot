/*jslint node: true */
'use strict';

let assocAttestorAddresses = {};

exports.getAttestationPayload = (user_address, user_email) => {
	return {
		address: user_address,
		profile: {
			email: user_email
		}
	};
};

exports.assocAttestorAddresses = assocAttestorAddresses;