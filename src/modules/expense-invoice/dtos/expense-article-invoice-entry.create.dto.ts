import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches } from 'class-validator';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { CreateArticleDto } from 'src/modules/article/article/dtos/article.create.dto';

export class ExpenseCreateArticleInvoiceEntryDto {
  @ApiProperty({ example: 100.0, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  unit_price?: number;

  @ApiProperty({ example: 2, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @ApiProperty({ example: 10, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  discount?: number;

  @ApiProperty({
    example: DISCOUNT_TYPES.PERCENTAGE,
    enum: DISCOUNT_TYPES,
    required: false,
  })
  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discount_type?: DISCOUNT_TYPES;

  @ApiProperty({ example: 1, type: Number, required: false })
  @IsOptional()
  @IsInt()
  article?: CreateArticleDto;

  @ApiProperty({ example: 1, type: Number, required: false })
  @IsOptional()
  @IsInt()
  articleId?: number;

  @ApiProperty({ example: 1, type: Number, required: false })
  @IsOptional()
  @IsInt()
  invoiceId?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  taxes?: number[];

  @ApiProperty({ example: 'IPH15PRO-001' })
      @IsString()
      @IsNotEmpty()
      @Matches(/^[A-Za-z0-9\-_]+$/, { 
        message: 'Reference can only contain letters, numbers, hyphens and underscores' 
      })
      reference: string;
  
}
