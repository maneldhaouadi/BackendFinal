import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsInt, IsString, Matches, IsNotEmpty } from 'class-validator';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { CreateArticleDto } from 'src/modules/article/article/dtos/article.create.dto';

export class CreateArticleExpensQuotationEntryDto {
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

  @ApiProperty({ example: 200.0, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  subTotal?: number;

  @ApiProperty({ example: 220.0, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  total?: number;

  @ApiProperty({ type: CreateArticleDto, required: false })
  @IsOptional()
  article?: CreateArticleDto;

  @ApiProperty({ example: 1, type: Number, required: false })
  @IsOptional()
  @IsInt()
  articleId?: number;

  @ApiProperty({ example: 1, type: Number, required: false })
  @IsOptional()
  @IsInt()
  expenseQuotationId?: number;

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  taxes?: number[];

  @ApiProperty({ example: 2, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  orderedQuantity?: number;

  @ApiProperty({ example: 50, type: Number, required: false })
  @IsOptional()
  @IsNumber()
  originalStock?: number;

  @ApiProperty({ example: 'IPH15PRO-001' })
    @IsString()
    @IsNotEmpty()
    @Matches(/^[A-Za-z0-9\-_]+$/, { 
      message: 'Reference can only contain letters, numbers, hyphens and underscores' 
    })
    reference: string;


    @ApiProperty()
    id?: number;
    @ApiProperty({
      description: 'Titre à utiliser si aucun articleId fourni',
      required: false
    })
    @IsOptional()
    @IsString()
    title?: string;
  
    @ApiProperty({
      description: 'Description à utiliser si aucun articleId fourni',
      required: false
    })
    @IsOptional()
    @IsString()
    description?: string;


   
    

    

  }




