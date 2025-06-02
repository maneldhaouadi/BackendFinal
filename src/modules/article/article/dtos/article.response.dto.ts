import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsDate, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ArticleStatus } from '../interfaces/article-data.interface';

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

  @ApiProperty({ 
    example: 'draft', 
    enum: ['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted'] 
  })
  @IsEnum(['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted'])
  status: ArticleStatus; // Changé de string à ArticleStatus

  @ApiProperty({ example: 1, type: Number })
  @IsNumber()
  version: number;

  @ApiProperty({ example: 'Note sur l\'article', type: String, required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  // Simplifié pour correspondre à l'entity
  @ApiProperty({ type: 'string', format: 'binary', required: false })
  @IsOptional()
  justificatifFile?:  Express.Multer.File;

  @ApiProperty({ type: 'string', required: false })
  @IsOptional()
  justificatifFileName?: string;

  @ApiProperty({ type: 'string', required: false })
  @IsOptional()
  justificatifMimeType?: string;

  @ApiProperty({ type: 'number', required: false })
  @IsOptional()
  justificatifFileSize?: number;

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

  @ApiProperty({ example: 999.99, type: Number })
  @IsNumber()
  unitPrice: number;

  // Supprimé isDeletionRestricted car absent de l'entity

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
}