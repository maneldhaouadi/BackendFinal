/* eslint-disable prettier/prettier */
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';

export class CreateArticleExpensQuotationEntryTaxDto {
  @ApiProperty({})
  @IsNumber()
  taxId: number;

  @ApiProperty({})
  @IsNumber()
  expenseArticleEntryId?: number;
}
