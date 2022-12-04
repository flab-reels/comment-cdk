import { Stage, StageProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InfraStack } from './infra-stack';

export class InfraPipelineStage extends Stage {
    constructor(scope: Construct, id: string, props?: StageProps) {
        super(scope, id, props);

        new InfraStack(this, 'Infra', {
            // env :{
            //     account : '087334185325',
            //     region : 'ap-northeast-2'
            // }
        });
    }
}