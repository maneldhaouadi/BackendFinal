import { ApiProperty } from '@nestjs/swagger';
import { IsPositive } from 'class-validator';

export class ExpenseCreatePaymentInvoiceEntryDto {
  @ApiProperty({
    example: 1,
    type: Number,
  })
  expenseInvoiceId?: number;

  @ApiProperty({
    example: '150.0',
    type: Number,
  })
  @IsPositive()
  amount?: number;

  @ApiProperty({
    example: 1,
    type: Number,
  })
  digitAfterComma?: number;

  @ApiProperty({
    example: '3.3',
    type: Number,
  })
  exchangeRate?: number;

  @ApiProperty({
    example: '3.3',
    type: Number,
  })
  originalAmount?: number;

  @ApiProperty({
    example: '1',
    type: Number,
  })
  originalCurrencyId?: number;

}