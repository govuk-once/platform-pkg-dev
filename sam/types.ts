export interface SharedAssetCachedS3 {
  bucketName: string;
  objectKey: string;
}

export interface LocalResourceTable {
  type: 'table';
  localName: string;
  keySchema: { AttributeName: string; KeyType: 'HASH' | 'RANGE' }[];
  attributeDefinitions: {
    AttributeName: string;
    AttributeType: 'S' | 'N' | 'B';
  }[];
  ttlAttribute?: string;
}

export interface LocalResourceSQSQueue {
  type: 'sqs-queue';
  logicalId: string;
  localName: string;
}

export type LocalResourceSharedEnv = Record<string, string>;
