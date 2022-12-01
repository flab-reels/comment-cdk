import * as cdk from 'aws-cdk-lib';
import { SecretValue } from 'aws-cdk-lib';
import { CodePipeline, CodePipelineSource, ShellStep } from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";


export class Pipeline extends cdk.Stack {
    constructor(scope : Construct, id: string, props?: cdk.StackProps) {
        // provide your CI/CD account info her
        super(scope, 'Pipeline');

        // The basic pipeline declaration.
        const pipeline = new CodePipeline(this, 'Pipeline', {
            pipelineName : 'WorkshopPipeline',
            crossAccountKeys : false,
            synth : new ShellStep('Synth', {
                input : CodePipelineSource.gitHub('flab-reels/comment-cdk', 'main', {
                    authentication : SecretValue.secretsManager('pipeline-github-token'),
                }),
                installCommands : ['npm install -g aws-cdk'],
                commands: [
                    'npm ci',
                    'npm run build',
                    'npx cdk synth'
                ]
            })
        });
    }
}