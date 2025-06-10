const body = {
	title: 'test',
	url: `https://example.com/${Math.random()}`,
	html: '<body cz-shortcut-listen="true"><div><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents. You may use this domain in literature without prior coordination or asking for permission.</p><p><a href="https://www.iana.org/domains/example">More information...</a></p></div></body>',
};

const response = await fetch(
	'https://paip1r3t7j.execute-api.eu-west-1.amazonaws.com/prod/',
	{
		method: 'POST',
		body: JSON.stringify(body),
		headers: {
			'Content-Type': 'application/json',
			'x-api-key': 'W76GK763928L8g8TcMdMU8Dw2rQ4EZwv3eqf4Yp0',
		},
	},
);

console.log(response.status);
console.log(await response.json());
