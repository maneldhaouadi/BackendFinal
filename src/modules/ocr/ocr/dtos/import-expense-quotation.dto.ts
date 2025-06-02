// src/modules/expense-quotation/dtos/import-expense-quotation.dto.ts
import { IsOptional, IsString, IsNumber, IsPositive, IsDateString, IsEnum, IsBoolean } from 'class-validator';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';

export class ImportExpenseQuotationDto {
  @IsOptional()
  @IsString()
  sequential?: string;

  @IsOptional()
  @IsDateString()
  date?: Date;

  @IsOptional()
  @IsDateString()
  dueDate?: Date;

  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsString()
  generalConditions?: string;

  @IsOptional()
  @IsEnum(EXPENSQUOTATION_STATUS)
  status?: EXPENSQUOTATION_STATUS;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  taxStamp?: number;

  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discount_type?: DISCOUNT_TYPES;

  @IsOptional()
  @IsNumber()
  subTotal?: number;

  @IsOptional()
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsBoolean()
  showInvoiceAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  showDeliveryAddress?: boolean;

  @IsOptional()
  @IsBoolean()
  showArticleDescription?: boolean;

  @IsOptional()
  @IsBoolean()
  hasBankingDetails?: boolean;

  @IsOptional()
  @IsBoolean()
  hasGeneralConditions?: boolean;

  @IsOptional()
  @IsBoolean()
  hasTaxStamp?: boolean;
}