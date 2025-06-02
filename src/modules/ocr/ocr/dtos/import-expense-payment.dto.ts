// src/modules/expense-quotation/dtos/import-expense-payment.dto.ts
import { IsOptional, IsString, IsNumber, IsPositive, IsDateString, IsEnum } from 'class-validator';
import { DISCOUNT_TYPES } from 'src/app/enums/discount-types.enum';
import { EXPENSQUOTATION_STATUS } from 'src/modules/expense_quotation/enums/expensquotation-status.enum';

export class ImportExpensePaymentDto {
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
  @IsNumber()
  @IsPositive()
  taxStamp?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  discount?: number;

  @IsOptional()
  @IsEnum(DISCOUNT_TYPES)
  discount_type?: DISCOUNT_TYPES;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  subTotal?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  total?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}