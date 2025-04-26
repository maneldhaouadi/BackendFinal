import { ApiProperty } from '@nestjs/swagger';
import { ExpenseCreatePaymentInvoiceEntryDto } from './expense-payment-invoice-entry.create.dto';

export class UpdateExpensePaymentInvoiceEntryDto extends ExpenseCreatePaymentInvoiceEntryDto {
  @ApiProperty({ example: 1, type: Number })
  id: number;

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
