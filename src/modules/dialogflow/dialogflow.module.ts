import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DialogflowController } from './controllers/dialogflow.controller';
import { DialogflowService } from './services/dialogflow.service';
import { ExpensQuotationEntity } from '../expense_quotation/repositories/entities/expensquotation.entity';
import { ExpenseInvoiceEntity } from '../expense-invoice/repositories/entities/expense-invoice.entity';
import { ArticleExpensQuotationEntryEntity } from '../expense_quotation/repositories/entities/article-expensquotation-entry.entity';
import { CurrencyRepository } from '../currency/repositories/repository/currency.repository';
import { ArticleRepository } from '../article/repositories/repository/article.repository';
import { InterlocutorRepository } from '../interlocutor/repositories/repository/interlocutor.repository';
import { ExpenseArticleQuotationEntryRepository } from '../expense_quotation/repositories/repository/article-expensquotation-entry.repository';
import { CurrencyEntity } from '../currency/repositories/entities/currency.entity';
import { ArticleEntity } from '../article/repositories/entities/article.entity';
import { InterlocutorEntity } from '../interlocutor/repositories/entity/interlocutor.entity';
import { UploadEntity } from 'src/common/storage/repositories/entities/upload.entity';
import { StorageModule } from 'src/common/storage/storage.module'; // Import du StorageModule
import { FirmRepository } from '../firm/repositories/repository/firm.repository';
import { FirmEntity } from '../firm/repositories/entities/firm.entity';
import { HistoryRepository } from './repositories/repository/HistoryRepository';
import {HistoryEntity } from './repositories/entities/History.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpensQuotationEntity,
      ExpenseInvoiceEntity,
      ArticleExpensQuotationEntryEntity,
      CurrencyEntity,
      ArticleEntity,
      InterlocutorEntity,
      FirmEntity,
      UploadEntity,
      HistoryEntity
    ]),
    StorageModule, // Import du StorageModule qui contient le StorageService
  ],
  controllers: [DialogflowController],
  providers: [
    DialogflowService,
    CurrencyRepository,
    ArticleRepository,
    InterlocutorRepository,
    FirmRepository,
    ExpenseArticleQuotationEntryRepository,
    HistoryRepository
  ],
  exports: [DialogflowService],
})
export class DialogflowModule {}