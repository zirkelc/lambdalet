javascript: (async () => {
	const apiKey = 'W76GK763928L8g8TcMdMU8Dw2rQ4EZwv3eqf4Yp0';
	const apiUrl = 'https://paip1r3t7j.execute-api.eu-west-1.amazonaws.com/prod/';
	const url = new URL(apiUrl);
	url.searchParams.set('apiKey', apiKey);

	async function fetchCSP() {
		try {
			const response = await fetch(window.location.href, { method: 'HEAD' });
			const cspHeader =
				response.headers.get('Content-Security-Policy') ||
				response.headers.get('Content-Security-Policy-Report-Only');

			if (!cspHeader) return null;

			const directives = {};
			cspHeader.split(';').forEach((directive) => {
				const [key, ...values] = directive.trim().split(/\s+/);
				if (key) {
					directives[key] = values;
				}
			});

			return directives;
		} catch (error) {
			console.warn('Lambdalet.AI: Failed to check CSP headers:', error);
			return null;
		}
	}

	function allowsFetch(directives) {
		if (!directives) return true;
		const connectSrc = directives['connect-src'];
		const allowsFetch =
			!connectSrc ||
			connectSrc.includes('*') ||
			connectSrc.some((src) => {
				if (src === "'self'") return false;
				if (src === "'none'") return false;

				const cleanSrc = src.replace(/\*/g, '');
				return (
					apiUrl.startsWith(cleanSrc) ||
					cleanSrc.includes(new URL(apiUrl).hostname)
				);
			});

		console.log('Lambdalet.AI: allowsFetch', allowsFetch, connectSrc);

		return allowsFetch;
	}

	function allowsFormAction(directives) {
		if (!directives) return true;
		const formAction = directives['form-action'];
		const allowsFormAction =
			!formAction ||
			formAction.includes('*') ||
			formAction.some((src) => {
				if (src === "'self'") return false;
				if (src === "'none'") return false;

				const cleanSrc = src.replace(/\*/g, '');
				return (
					apiUrl.startsWith(cleanSrc) ||
					cleanSrc.includes(new URL(apiUrl).hostname)
				);
			});
		console.log('Lambdalet.AI: allowsFormAction', allowsFormAction, formAction);
		return allowsFormAction;
	}

	function getSelectedHTML() {
		if (window.getSelection) {
			const selection = window.getSelection();
			if (selection.rangeCount) {
				const container = document.createElement('div');
				for (let i = 0; i < selection.rangeCount; ++i) {
					container.appendChild(selection.getRangeAt(i).cloneContents());
				}
				return container.innerHTML;
			}
		}
		if (document.selection && document.selection.type === 'Text') {
			return document.selection.createRange().htmlText;
		}

		return undefined;
	}

	async function tryFetch(data) {
		try {
			await fetch(url, {
				method: 'POST',
				body: new FormData({
					...data,
					invoke: 'fetch',
				}),
			});
			return true;
		} catch (error) {
			console.warn('Lambdalet.AI: Fetch method failed:', error);
			return false;
		}
	}

	async function tryFormAction(data) {
		return new Promise((resolve) => {
			let hasCspViolation = false;
			document.addEventListener('securitypolicyviolation', () => {
				hasCspViolation = true;
				console.error('Lambdalet.AI: CSP violation detected');
			});

			const form = document.createElement('form');
			form.method = 'POST';
			form.action = url.toString();
			form.target = '_blank';
			document.body.appendChild(form);

			Object.entries({
				...data,
				invoke: 'form-blank',
			}).forEach(([key, value]) => {
				const input = document.createElement('input');
				input.type = 'hidden';
				input.name = key;
				input.value = value;
				form.appendChild(input);
			});

			form.submit();
			document.body.removeChild(form);

			setTimeout(() => {
				if (hasCspViolation) {
					console.warn('Lambdalet.AI: Form action failed with CSP violation');
					resolve(false);
				} else {
					resolve(true);
				}
			}, 100);
		});
	}

	function tryWindowOpen(data) {
		Object.entries({ ...data, html: undefined, invoke: 'window-open' }).forEach(
			([key, value]) => {
				if (value !== undefined) url.searchParams.set(key, value);
			},
		);

		const newWindow = window.open(url, '_blank');

		return !!newWindow;
	}

	const selectedHTML = getSelectedHTML();
	const hasSelection = !!selectedHTML;

	const data = {
		html: hasSelection ? selectedHTML : document.body.innerHTML,
		mode: hasSelection ? 'selection' : 'document',
		url: window.location.href,
		title: document.title,
	};

	const cspHeader = await fetchCSP();
	let success = false;

	if (allowsFetch(cspHeader)) {
		success = await tryFetch(data);
	}

	if (!success && allowsFormAction(cspHeader)) {
		success = await tryFormAction(data);
	}

	if (!success) {
		success = tryWindowOpen(data);
	}

	if (success) {
		alert(
			`Saved ${data.mode === 'selection' ? 'text selection' : 'full page'} to Lambdalet.AI`,
		);
	} else {
		alert('Could not save to Lambdalet.AI. See console for details.');
	}
})();
