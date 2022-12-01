import * as cdk from 'aws-cdk-lib';
import { SecretValue } from 'aws-cdk-lib';
import { CodePipeline, CodePipelineSource, ShellStep } from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";


export class Pipeline extends cdk.Stack {
    constructor(scope : Construct, id: string, props?: cdk.StackProps) {
        // provide your CI/CD account info her
        super(scope, 'Pipeline');

        // with AWS Codepipeline this will create Deployment pipeline
        // The basic pipeline declaration.

        // https://aws.amazon.com/blogs/developer/cdk-pipelines-continuous-delivery-for-aws-cdk-applications/

        // git practice
        
        // Source  – It fetches the source of your CDK app from your forked GitHub repo 
        // and triggers the pipeline every time you push new commits to it.
        const pipeline = new CodePipeline(this, 'Pipeline', {
            pipelineName : 'WorkshopPipeline',
            crossAccountKeys : false,
            synth : new ShellStep('Synth', { // it will be pointing the following github repo
                input : CodePipelineSource.gitHub('flab-reels/comment-cdk', 'main', {
                    authentication : SecretValue.secretsManager('pipeline-github-token'),
                }),
                installCommands : ['npm install -g aws-cdk'],
                //will genetate self mutating pipeline
                commands: [
                    'npm ci',
                    'npm run build',
                    'npx cdk synth'
                ]
            })
        });
    }
}