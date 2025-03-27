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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ExpensQuotationEntity,
      ExpenseInvoiceEntity,
      ArticleExpensQuotationEntryEntity,
      CurrencyEntity,
      ArticleEntity,
      InterlocutorEntity
      // Ajoutez ici d'autres entités si nécessaire
    ]),
  ],
  controllers: [DialogflowController],
  providers: [
    DialogflowService,
    CurrencyRepository,
    ArticleRepository,
    InterlocutorRepository,
    ExpenseArticleQuotationEntryRepository,
  ],
  exports: [DialogflowService],
})
export class DialogflowModule {}