import { Logger } from '@aws-lambda-powertools/logger';
import { Client, type BlockObjectRequest } from '@notionhq/client';
import { markdownToBlocks } from '@tryfabric/martian';
import { NotionEnvSchema } from '../schema.js';

const logger = new Logger();

const createClient = () => {
	const env = NotionEnvSchema.parse(process.env);

	const notion = new Client({
		auth: env.NOTION_TOKEN,
	});

	const databaseId = env.NOTION_DATABASE_ID;

	return { notion, databaseId };
};

type ToBlocks = {
	markdown: string;
};
/**
 * Convert the markdown to Notion blocks.
 */
export const toBlocks = ({ markdown }: ToBlocks): BlockObjectRequest[] => {
	const blocks = markdownToBlocks(markdown, {
		notionLimits: {
			onError: (err: Error) => {
				console.error(err);
			},
		},
	});

	return blocks as BlockObjectRequest[];
};

const chunk = <T>(array: T[], size: number) => {
	return Array.from({ length: Math.ceil(array.length / size) }, (_, i) =>
		array.slice(i * size, (i + 1) * size),
	);
};

/**
 * Initialize the database with the required properties.
 */
const initializeDatabase = async () => {
	const { databaseId, notion } = createClient();

	/**
	 * Retrieve the database.
	 */
	const database = await notion.databases.retrieve({
		database_id: databaseId,
	});

	if (!database) throw new Error(`Database does not exist: ${databaseId}`);

	const properties = Object.values(database.properties);

	/**
	 * Create default properties if they don't exist.
	 * - URL
	 * - Created At
	 * - Last Updated
	 */
	if (!properties.find((property) => property.type === 'url')) {
		properties.push({
			id: 'URL',
			name: 'URL',
			type: 'url',
			description: null,
			url: {},
		});
	}
	if (!properties.find((property) => property.type === 'created_time')) {
		properties.push({
			id: 'Created At',
			name: 'Created At',
			type: 'created_time',
			description: null,
			created_time: {},
		});
	}
	if (!properties.find((property) => property.type === 'last_edited_time')) {
		properties.push({
			id: 'Last Updated',
			name: 'Last Updated',
			type: 'last_edited_time',
			description: null,
			last_edited_time: {},
		});
	}

	/**
	 * Update the database with the new properties.
	 */
	await notion.databases.update({
		database_id: databaseId,
		properties: Object.fromEntries(
			properties.map((property) => [property.id, property]),
		),
	});
};

type CreatePage = {
	title: string;
	url: string;
};

/**
 * Create a new page in the database.
 */
export const createPage = async ({ title, url }: CreatePage) => {
	const { databaseId, notion } = createClient();

	await initializeDatabase();

	/**
	 * Query the database for the page with the given URL.
	 */
	const result = await notion.databases.query({
		database_id: databaseId,
		filter: {
			property: 'URL',
			url: {
				equals: url,
			},
		},
	});

	const oldPage = result.results.find((result) => result.object === 'page');

	/**
	 * Delete (archive) the old page if it exists.
	 * Ideally, we would only update the content but keep the page.
	 * But the Notion API doesn't support batch deletion of blocks and deleting many blocks will cause rate limiting.
	 */
	if (oldPage) {
		await notion.pages.update({
			page_id: oldPage.id,
			archived: true,
		});
	}

	/**
	 * Create a new page in the database.
	 */
	const newPage = await notion.pages.create({
		parent: {
			database_id: databaseId,
		},
		properties: {
			Name: {
				title: [
					{
						text: { content: title },
					},
				],
			},
			URL: {
				url,
			},
		},
	});

	return newPage.id;
};

type AddContent = {
	pageId: string;
	markdown: string;
};

/**
 * Convert the markdown to Notion blocks and add them to the page.
 */
export const addContent = async ({ pageId, markdown }: AddContent) => {
	const { notion } = createClient();

	// TODO fix
	const blocks = toBlocks({ markdown }).filter(
		(block) => block.type !== 'bulleted_list_item',
	);

	for (const children of chunk(blocks, 100)) {
		await notion.blocks.children.append({
			block_id: pageId,
			children,
		});
	}
};
