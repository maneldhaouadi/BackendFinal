import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsNotEmpty, Matches } from 'class-validator';
import { ArticleStatus } from '../interfaces/article-data.interface';

export class UpdateArticleDto {
  @ApiProperty({ required: false, example: 'Nouveau titre' })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false, example: 'Nouvelle description' })
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

  @ApiProperty({ required: false, example: 30 })
  @IsNumber()
  @IsOptional()
  quantityInStock?: number;

  @ApiProperty({
    required: false,
    example: 'active',
    enum: ['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted']
  })
  @IsString()
  @IsOptional()
  status?: ArticleStatus; // Utilisez l'enum


  @ApiProperty({ required: false, example: 'Notes modifiées' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    required: false,
    description: 'Justificatif mis à jour au format fichier'
  })
  @IsOptional()
  justificatifFile?: Express.Multer.File;

  @ApiProperty({ required: false, example: 1099.99 })
  @IsNumber()
  @IsOptional()
  unitPrice?: number;
}
