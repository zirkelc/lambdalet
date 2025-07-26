import { z } from 'zod';

/**
 * API Gateway request schema.
 * Use only string values because the request is sent as form data.
 */
export type ApiGatewayRequest = z.infer<typeof ApiGatewayRequestSchema>;
export const ApiGatewayRequestSchema = z.object({
	url: z.string().url(),
	html: z.string().optional(),
	title: z.string(),
	mode: z.enum(['document', 'selection']).default('document'),
	invoke: z
		.enum(['fetch', 'form-blank', 'form-self', 'window-open'])
		.default('fetch'),
});

/**
 * SQS message schema.
 */
export type SqsMessage = z.infer<typeof SqsMessageSchema>;
export const SqsMessageSchema = z.object({
	bucket: z.string(),
	key: z.string(),
});

/**
 * Environment variables for AWS resources.
 */
export const AwsEnvSchema = z.object({
	BUCKET_NAME: z.string(),
	QUEUE_URL: z.string(),
	FETCH_QUEUE_URL: z.string(),
});

/**
 * Environment variables for Notion.
 */
export const NotionEnvSchema = z.object({
	NOTION_TOKEN: z.string(),
	NOTION_DATABASE_ID: z.string(),
});
