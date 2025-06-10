import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

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
	await sqs.send(
		new SendMessageCommand({
			QueueUrl: queueUrl,
			MessageBody: JSON.stringify(message),
			MessageGroupId: groupId,
			MessageDeduplicationId: deduplicationId,
		}),
	);
};
