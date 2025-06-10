import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import {
	ApiKeySourceType,
	Cors,
	LambdaIntegration,
	Period,
	RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import 'dotenv/config';
import {
	BEDROCK_FOUNDATION_MODEL_ID,
	BEDROCK_INFERENCE_PROFILE_ID,
} from '../src/libs/bedrock.js';
import { NotionEnvSchema } from '../src/schema.js';

export class LambdaletStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		const notionEnv = NotionEnvSchema.parse(process.env);

		/**
		 * We manage the timeout within the lambda function, so we can set the max here.
		 */
		const timeout = Duration.minutes(15);

		const processRequestLambda = new NodejsFunction(
			this,
			'lambdalet-process-request',
			{
				functionName: 'lambdalet-process-request',
				entry: 'src/functions/process-request.ts',
				handler: 'handler',
				runtime: Runtime.NODEJS_22_X,
				timeout,
				memorySize: 2048,
				reservedConcurrentExecutions: 1,
				environment: {
					NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
					...notionEnv,
				},
				bundling: {
					format: OutputFormat.ESM,
					nodeModules: ['@smithy/eventstream-codec', '@tryfabric/martian'],
				},
				layers: [],
			},
		);

		processRequestLambda.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['bedrock:InvokeModel'],
				resources: [
					`arn:aws:bedrock:*:*:foundation-model/${BEDROCK_FOUNDATION_MODEL_ID}`,
					`arn:aws:bedrock:*:*:inference-profile/${BEDROCK_INFERENCE_PROFILE_ID}`,
				],
			}),
		);

		const bucket = new s3.Bucket(this, 'lambdalet-bucket', {
			lifecycleRules: [
				{
					expiration: Duration.days(7),
				},
			],
		});
		bucket.grantRead(processRequestLambda);

		const queue = new sqs.Queue(this, 'lambdalet-queue', {
			queueName: 'lambdalet-queue.fifo',
			fifo: true,
			contentBasedDeduplication: true,
			visibilityTimeout: timeout,
		});

		/**
		 * Use batch size 1 to avoid timeouts
		 */
		processRequestLambda.addEventSource(
			new SqsEventSource(queue, { batchSize: 1 }),
		);

		const queueRequestLambda = new NodejsFunction(
			this,
			'lambdalet-queue-request',
			{
				functionName: 'lambdalet-queue-request',
				entry: 'src/functions/queue-request.ts',
				handler: 'handler',
				runtime: Runtime.NODEJS_22_X,
				timeout: Duration.seconds(30),
				memorySize: 256,
				environment: {
					NODE_OPTIONS: '--enable-source-maps --stack-trace-limit=1000',
					BUCKET_NAME: bucket.bucketName,
					QUEUE_URL: queue.queueUrl,
				},
				bundling: {
					format: OutputFormat.ESM,
				},
			},
		);

		bucket.grantWrite(queueRequestLambda);
		queue.grantSendMessages(queueRequestLambda);

		const api = new RestApi(this, 'lambdalet-api', {
			apiKeySourceType: ApiKeySourceType.HEADER,
			defaultCorsPreflightOptions: {
				allowOrigins: Cors.ALL_ORIGINS,
				allowMethods: Cors.ALL_METHODS,
				allowHeaders: ['x-api-key', 'content-type'],
			},
		});

		api.root.addMethod('POST', new LambdaIntegration(queueRequestLambda), {
			apiKeyRequired: true,
		});

		const key = api.addApiKey('lambdalet-apikey');
		const plan = api.addUsagePlan('lambdalet-usageplan', {
			quota: {
				limit: 100,
				period: Period.DAY,
			},
			throttle: {
				rateLimit: 10,
				burstLimit: 2,
			},
		});

		plan.addApiKey(key);
		plan.addApiStage({ api, stage: api.deploymentStage });

		new cdk.CfnOutput(this, 'ApiUrl', {
			value: api.url,
		});

		new cdk.CfnOutput(this, 'ApiKey', {
			value: key.keyId,
		});
	}
}
