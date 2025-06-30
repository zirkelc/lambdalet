import TurndownService from 'turndown';

const isDescendantOf = (node: Node, tagName: string): boolean => {
	let current = node.parentNode;
	while (current) {
		if (current.nodeName.toUpperCase() === tagName.toUpperCase()) return true;
		current = current.parentNode;
	}
	return false;
};

type ToMarkdown = {
	html: string;
	url: string;
};

/**
 * Convert the HTML to Markdown.
 */
export const toMarkdown = ({ html, url }: ToMarkdown) => {
	const turndownService = new TurndownService({
		headingStyle: 'atx',
		bulletListMarker: '-',
		codeBlockStyle: 'fenced',
		fence: '```',
	}).remove(['script', 'noscript', 'style', 'link']);

	/**
	 * Custom rule to convert links to absolute URLs, because Notion doesn't support relative URLs.
	 */
	turndownService.addRule('link', {
		filter: (node, options) => node.nodeName === 'A',
		replacement: (content, node) => {
			const element = node as HTMLAnchorElement;
			const href = element.getAttribute('href')?.trim();

			if (!href) {
				return content;
			}

			const absoluteUrl = new URL(href, url).toString();
			const text = content.replace(/\n+/g, ' ').trim();
			if (!text) return '';

			return `[${text}](${absoluteUrl})`;
		},
	});

	/**
	 * Custom rule to omit empty lists.
	 */
	turndownService.addRule('list', {
		filter: ['ul', 'ol'],

		replacement: (content, node) => {
			if (!content.trim()) return '';

			const parent = node.parentNode;
			if (parent?.nodeName === 'LI' && parent.lastElementChild === node)
				return `\n${content}`;

			return `\n\n${content}\n\n`;
		},
	});

	/**
	 * Custom rule to omit empty list items.
	 */
	turndownService.addRule('listItem', {
		filter: 'li',

		replacement: (content, node, options) => {
			if (!content.trim()) return '';

			const element = node as HTMLElement;
			const text = content
				.replace(/^\n+/, '') // remove leading newlines
				.replace(/\n+$/, '\n') // replace trailing newlines with just a single one
				.replace(/\n/gm, '\n  '); // indent

			let prefix = `${options.bulletListMarker} `; // Use a single space after the bullet point
			const parent = element.parentNode;

			if (parent?.nodeName === 'OL') {
				const start = (parent as HTMLOListElement).getAttribute('start');
				const index = Array.from(parent.children).indexOf(element);
				prefix = `${start ? Number(start) + index : index + 1}. `;
			}
			return (
				prefix + text + (element.nextSibling && !/\n$/.test(text) ? '\n' : '')
			);
		},
	});

	/**
	 * Custom rule to remove line breaks from headings.
	 */
	turndownService.addRule('headings', {
		filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
		replacement: (content, node, options) => {
			const hLevel = Number(node.nodeName.charAt(1));

			// Replace line breaks with spaces and trim
			const text = content.replace(/\n/g, ' ').trim();
			if (!text) return '';

			return `\n\n${'#'.repeat(hLevel)} ${text}\n\n`;
		},
	});

	/**
	 * Custom rule to handle inline code and code blocks.
	 */
	turndownService.addRule('code', {
		filter: 'code',

		replacement: (content, node, options) => {
			const element = node as HTMLElement;
			const isBlock = isDescendantOf(element, 'pre');

			if (isBlock) {
				const className = element.getAttribute('class') || '';
				const language = (className.match(/language-(\S+)/) || [null, ''])[1];
				const code = element.textContent || '';

				let fenceSize = 3;
				const fenceInCodeRegex = /^`{3,}/gm;

				for (;;) {
					const match = code.match(fenceInCodeRegex);
					if (!match) break;
					if (match[0].length >= fenceSize) {
						fenceSize = match[0].length + 1;
					}
				}
				const fence = '`'.repeat(fenceSize);

				return `\n\n${fence}${language}\n${code.replace(/\n$/, '')}\n${fence}\n\n`;
			}

			if (!content.trim()) return '';
			const code = content.replace(/\r?\n|\r/g, ' ');

			const extraSpace = /^`|^ .*?[^ ].* $|`$/.test(code) ? ' ' : '';
			let delimiter = '`';
			const matches: Array<string> = code.match(/`+/gm) || [];
			while (matches.includes(delimiter)) {
				delimiter = `${delimiter}\``;
			}

			return `${delimiter}${extraSpace}${code}${extraSpace}${delimiter}`;
		},
	});

	const markdown = turndownService.turndown(html);

	return markdown;
};
