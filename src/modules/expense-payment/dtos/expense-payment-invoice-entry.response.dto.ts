import { ApiProperty } from '@nestjs/swagger';

export class ResponseExpensePaymentInvoiceEntryDto {
  @ApiProperty({ example: 1, type: Number })
  id: number;

  @ApiProperty({
    example: 1,
    type: Number,
  })
  expensePaymentId?: number;

  @ApiProperty({
    example: 1,
    type: Number,
  })
  expenseInvoiceId?: number;

  @ApiProperty({
    example: '150.0',
    type: Number,
  })
  amount?: number;

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
