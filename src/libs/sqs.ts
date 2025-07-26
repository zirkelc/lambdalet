import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createHash } from 'node:crypto';

const sqs = new SQSClient({});

type SendMessageInput<TMessage extends Record<string, unknown>> = {
	queueUrl: string;
	groupId: string;
	deduplicationId: string;
	message: TMessage;
};

/**
 * Send a message to an SQS queue.
 */
export const sendMessage = async <TMessage extends Record<string, unknown>>({
	queueUrl,
	groupId,
	deduplicationId,
	message,
}: SendMessageInput<TMessage>) => {
	const response = await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(message),
			MessageGroupId: groupId,
			MessageDeduplicationId: deduplicationId,
		}),
	);

	if (!response.MessageId) throw new Error('Failed to send message to SQS');

	return response.MessageId;
};

/**
 * Hash the URL to create a deterministic key for the S3 object and SQS deduplication ID.
 * Using the plain URL as key could exceed the 1024 character limit for the S3 key and 128 character limit for the SQS deduplication ID.
 */
export const createMessageId = (url: string) => {
	return createHash('sha256').update(url).digest('hex');
};
