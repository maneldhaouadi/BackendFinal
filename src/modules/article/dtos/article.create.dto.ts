import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsNumber, Matches } from 'class-validator';

export class CreateArticleDto {
  @ApiProperty({ example: 'iPhone 15 Pro', required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ example: 'Latest model with A17 Pro chip', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'IPH15PRO-001' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9\-_]+$/, { 
    message: 'Reference can only contain letters, numbers, hyphens and underscores' 
  })
  reference: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  quantityInStock: number;

  @ApiProperty({ 
    enum: ['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted'],
    example: 'active'
  })
  @IsString()
  status: string;

  @ApiProperty({ example: 'Special edition', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ 
    type: 'string', 
    format: 'binary', 
    required: false,
    description: 'PDF/PNG/JPG file up to 5MB' 
  })
  @IsOptional()
  justificatifFile?: Express.Multer.File;

  @ApiProperty({ example: 999.99, type: Number })
  @IsNumber()
  unitPrice: number;
}