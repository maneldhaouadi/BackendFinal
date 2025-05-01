import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsDate, IsOptional, IsBoolean } from 'class-validator';

export class ResponseArticleDto {
  @ApiProperty({ example: 1, type: Number })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 'iPhone 14', type: String, required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ example: 'Smartphone Apple dernière génération', type: String, required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'A12345', type: String })
  @IsString()
  reference: string;

  @ApiProperty({ example: 50, type: Number })
  @IsNumber()
  quantityInStock: number;

  @ApiProperty({ example: 'draft', enum: ['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted'] })
  @IsString()
  status: string;

  @ApiProperty({ example: 1, type: Number })
  @IsNumber()
  version: number;

  @ApiProperty({ example: 'Note sur l\'article', type: String, required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    type: 'object',
    required: false,
    properties: {
      data: { type: 'string', format: 'binary' },
      filename: { type: 'string' },
      mimeType: { type: 'string' },
      size: { type: 'number' },
    }
  })
  @IsOptional()
  justificatifFile?: {
    data: Buffer;
    filename?: string;
    mimeType?: string;
    size?: number;
  };

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  createdAt?: Date;

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  updatedAt?: Date;

  @ApiProperty({ type: Date, required: false })
  @IsDate()
  @IsOptional()
  deletedAt?: Date;

  @ApiProperty({ type: Boolean, required: false })
  @IsBoolean()
  @IsOptional()
  isDeletionRestricted?: boolean;

  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: {
        version: { type: 'number' },
        changes: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              oldValue: {},
              newValue: {},
            }
          }
        },
        date: { type: 'string', format: 'date-time' }
      }
    }
  })
  @IsOptional()
  history?: Array<{
    version: number;
    changes: Record<string, { oldValue: any; newValue: any }>;
    date: Date;
  }>;

  @ApiProperty({ example: 999.99, type: Number })
  @IsNumber()
  unitPrice: number;
}
