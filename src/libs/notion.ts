import { Client, type BlockObjectRequest } from '@notionhq/client';
import type { UpdateDatabaseParameters } from '@notionhq/client/build/src/api-endpoints.js';
import { markdownToBlocks } from '@tryfabric/martian';
import { appendBlocks } from 'notion-helper';
import { NotionEnvSchema } from '../schema.js';

type UpdateDatabaseProperties = UpdateDatabaseParameters['properties'];

type NotionStatus = 'Not started' | 'In progress' | 'Done' | 'Failed';

export const createClient = () => {
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
	const updateProperties: UpdateDatabaseProperties = {};

	/**
	 * Create default properties if they don't exist.
	 * - URL
	 * - Created At
	 * - Last Updated
	 */
	if (!properties.find((property) => property.name === 'URL')) {
		updateProperties.URL = {
			name: 'URL',
			type: 'url',
			description: null,
			url: {},
		};
	}
	if (!properties.find((property) => property.name === 'Created At')) {
		updateProperties.CreatedAt = {
			name: 'Created At',
			type: 'created_time',
			description: null,
			created_time: {},
		};
	}
	if (!properties.find((property) => property.name === 'Last Updated')) {
		updateProperties.LastUpdated = {
			name: 'Last Updated',
			type: 'last_edited_time',
			description: null,
			last_edited_time: {},
		};
	}
	if (!properties.find((property) => property.name === 'Status')) {
		updateProperties.Status = {
			name: 'Status',
			type: 'select',
			description: null,
			select: {
				options: [
					{
						name: 'Not started',
						color: 'default',
						description: null,
					},
					{
						name: 'In progress',
						color: 'blue',
						description: null,
					},
					{
						name: 'Done',
						color: 'green',
						description: null,
					},
					{
						name: 'Failed',
						color: 'red',
						description: null,
					},
				],
			},
		};
	}

	/**
	 * Update the database with the new properties.
	 */
	await notion.databases.update({
		database_id: databaseId,
		properties: updateProperties,
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
			Status: {
				select: {
					name: 'In progress',
				},
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

	const blocks = toBlocks({ markdown });

	await appendBlocks({
		block_id: pageId,
		children: blocks,
		client: notion,
	});
};

type UpdateStatus = {
	pageId: string;
	status: NotionStatus;
};

/**
 * Update the status of the page.
 */
export const updateStatus = async ({ pageId, status }: UpdateStatus) => {
	const { notion } = createClient();

	await notion.pages.update({
		page_id: pageId,
		properties: {
			Status: {
				select: {
					name: status,
				},
			},
		},
	});
};

type AddComment = {
	pageId: string;
	comment: string;
};

/**
 * Add a comment to the page.
 */
export const addComment = async ({ pageId, comment }: AddComment) => {
	const { notion } = createClient();

	await notion.comments.create({
		parent: {
			page_id: pageId,
		},
		rich_text: [
			{
				text: {
					content: comment,
				},
			},
		],
	});
};
