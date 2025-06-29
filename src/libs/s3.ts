import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
} from '@aws-sdk/client-s3';
import type { z, ZodSchema } from 'zod';
const s3 = new S3Client({});

type GetObjectInput<TSchema extends ZodSchema> = {
	bucket: string;
	key: string;
	schema: TSchema;
};

/**
 * Get an object from S3 and parse it as JSON using the given schema.
 */
export const getObject = async <TSchema extends ZodSchema>({
	bucket,
	key,
	schema,
}: GetObjectInput<TSchema>): Promise<z.infer<TSchema>> => {
	const { Body } = await s3.send(
		new GetObjectCommand({
			Bucket: bucket,
			Key: key,
		}),
	);

	const json = (await Body?.transformToString()) ?? '';

	return schema.parse(JSON.parse(json));
};

type PutObjectInput<
	TObject extends Record<string, unknown>,
	TMetadata extends Record<string, string> | undefined = undefined,
> = {
	bucket: string;
	key: string;
	object: TObject;
	metadata?: TMetadata;
};

/**
 * Put an object to S3 and convert it to JSON.
 */
export const putObject = async <
	TObject extends Record<string, unknown>,
	TMetadata extends Record<string, string> | undefined = undefined,
>({
	bucket,
	key,
	object,
	metadata,
}: PutObjectInput<TObject, TMetadata>) => {
	await s3.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: JSON.stringify(object),
			Metadata: metadata,
		}),
	);
};
