import { SecretValue, Stack, StackProps } from "aws-cdk-lib"
import { BuildSpec, LinuxBuildImage, PipelineProject } from "aws-cdk-lib/aws-codebuild";
import { Artifact, Pipeline } from "aws-cdk-lib/aws-codepipeline";
import { CodeBuildAction, GitHubSourceAction } from "aws-cdk-lib/aws-codepipeline-actions";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";


export class InfraStack extends Stack {
    constructor(scope : Construct, id:string, props : StackProps) {
        super(scope, id, props);

        // deploy codepipeline from cdk pipelines
        // This is the main object which combines all the stages of the pipeline
        const pipeline = new Pipeline(this, 'comment-pipeline', {
            pipelineName : 'comment-pipeline',
            crossAccountKeys : false, // save 1$/month
        });

        /** 
         * Source Stage
         */
        // artifact will be stored in s3
        // The output artifact (any files to be built) from the previous step is ingested as an input artifact to the Build stage
        const sourceOutput = new Artifact();

        // initialize source action
        const sourceAction = new GitHubSourceAction({
            actionName : 'Comment_Github_Source',
            owner : 'flab-reels',
            repo : 'comment',
            oauthToken : SecretValue.secretsManager('pipeline-github-token'), // A GitHub OAuth token to use for authentication.
            branch : 'main',
            output : sourceOutput
        })

        pipeline.addStage({
            stageName : 'Source',
            actions : [sourceAction]
        })

        const project = new PipelineProject(this, 'CommentProject', {
            projectName : "CommentProject",
            environment : {
                buildImage : LinuxBuildImage.STANDARD_4_0,
                privileged : true,
            },
            environmentVariables : {
                ACCOUNT_ID: {
                    value: this.account
                },
                ACCOUNT_REGION: {
                    value: this.region
                },
                // REPOSITORY_URI : {
                //     value : ecr_repository.repositoryUri
                // },
                IMAGE_TAG : {
                    value : 'latest'
                }
            },
            buildSpec : BuildSpec.fromObject({
                version : '0.2',
                phases : {
                    install: {
                        "runtime-versions": {
                            java: 'corretto11',
                        },
                    },
                    pre_build : {
                        commands: [
                            'echo Java version check',
                            'java --version',
                            'echo Logging in to Amazon ECR...',
                            'aws ecr get-login-password --region $ACCOUNT_REGION | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$ACCOUNT_REGION.amazonaws.com',
                            'COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)',
                            //'IMAGE_TAG=build-$(echo $CODEBUILD_BUILD_ID | awk -F":" \'{print $2}\')',
                            'chmod +x gradlew'
                        ]
                    },
                    build: {
                        commands: [
                            'echo Build started on `date`',
                            './gradlew bootBuildImage --imageName=$REPOSITORY_URI:$IMAGE_TAG',
                            'export imageTag=$IMAGE_TAG',
                            'echo imageTag=$IMAGE_TAG'
                        ],
                    },
                    post_build: {
                        commands: [
                            'echo Pushing the Docker image...',
                            'docker push  $REPOSITORY_URI:$IMAGE_TAG',
                            "echo creating imagedefinitions.json dynamically",
                            'printf \'{"ImageURI":"%s"}\' $REPOSITORY_URI:$IMAGE_TAG > imageDetail.json',
                            'printf \'[{"name":"driver-service","imageUri":"%s"}]\' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json',
                            'echo Pushing Docker Image completed on `date`'
                        ]
                    }
                },
                artifacts: {
                    files: [
                        'imageDetail.json',
                        'imagedefinitions.json',
                    ]
                }
            })
        });

        project.role?.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryPowerUser'));

        // initialize build action
        const buildOutput = new Artifact();
        const buildAction = new CodeBuildAction({
            actionName : 'Comment_CodeBuild',
            project : project,
            input : sourceOutput,
            outputs : [buildOutput]
        })

        pipeline.addStage({
            stageName : 'Build',
            actions : [buildAction]
        })
    }
}