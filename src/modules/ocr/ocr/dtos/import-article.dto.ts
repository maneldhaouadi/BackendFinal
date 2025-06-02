import { IsOptional, IsString, IsNumber, IsPositive, IsEnum } from 'class-validator';
import { ArticleStatus } from 'src/modules/article/article/interfaces/article-data.interface';

export class ImportArticleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  reference: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  quantityInStock?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  unitPrice?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(['draft', 'active', 'inactive', 'archived', 'out_of_stock', 'pending_review', 'deleted'])
  status?: ArticleStatus;
}