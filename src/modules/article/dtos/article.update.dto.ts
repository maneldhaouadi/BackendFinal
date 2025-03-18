import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional } from 'class-validator';

export class UpdateArticleDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  subCategory?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  purchasePrice?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  salePrice?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  quantityInStock?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  history: Array<{
    version: number;
    changes: Record<string, { oldValue: any; newValue: any }>;
    date: Date;
  }>;
}