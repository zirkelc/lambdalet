import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { Logger } from '@aws-lambda-powertools/logger';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { generateText } from 'ai';

export const BEDROCK_FOUNDATION_MODEL_ID =
	'anthropic.claude-3-7-sonnet-20250219-v1:0';
export const BEDROCK_INFERENCE_PROFILE_ID =
	'us.anthropic.claude-3-7-sonnet-20250219-v1:0';

const logger = new Logger();

const bedrock = createAmazonBedrock({
	region: 'us-east-1',
	credentialProvider: fromNodeProviderChain(),
});

const model = bedrock(BEDROCK_INFERENCE_PROFILE_ID);

type ExtractMainContent = {
	markdown: string;
	url: string;
};

/**
 * Extract the main content from the given markdown.
 */
export const extractMainContent = async ({
	markdown,
	url,
}: ExtractMainContent) => {
	const prompt = `
Here is the content from the URL converted from HTML to markdown:
<url>${url}</url>

<markdown>
${markdown}
</markdown>

Your task is to extract the main content from the given markdown.

Wrap your response in <content> tags.
<content>
[Your markdown content here]
</content>
	`;

	const { usage, finishReason, text } = await generateText({
		model,
		prompt,
		abortSignal: AbortSignal.timeout(5 * 60 * 1000), // 5 minutes
	});

	logger.info('Usage', {
		usage,
		finishReason,
	});

	const contentStart = text.indexOf('<content>');
	const contentEnd = text.lastIndexOf('</content>');

	/**
	 * Slice the content between the <content> tags.
	 * If the tags are not found, return the entire text.
	 */
	const content =
		contentStart !== -1 && contentEnd !== -1
			? text.slice(contentStart, contentEnd)
			: text;

	return content;
};
