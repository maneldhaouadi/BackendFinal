import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { TypeOrmModule } from '@nestjs/typeorm';

// Controllers
import { OcrController } from './controllers/ocr.controller';

// Services
import { OcrService } from './services/ocr.service';
import { PdfArticleExtractorService } from './services/pdf-article-extractor.service';
import { ArticleOcrController } from './controllers/articleOcrController';
import { ArticleOcrService } from './services/articleOcrService';
import { PdfExtractController } from './controllers/article-import.controller';
import { ExpenseQuotationOcrService } from './services/expense-quotation-ocr.service';
import { ExpenseQuotationOcrController } from './controllers/expense-quotation-ocr.controller';
import { PaymentOcrController } from './controllers/payment-ocr.controller';
import { PaymentOcrService } from './services/paymentOcrService';
import { InvoiceOcrService } from './services/invoice-ocr.service';
import { InvoiceOcrController } from './controllers/invoice-ocr.controller';
import { PdfExpenseQuotationExtractController } from './controllers/pdf-expense-quotation-extract.controller';
import { PdfExpenseQuotationExtractorService } from './services/pdf-expense-quotation-extractor.service';
import { PdfExpenseInvoiceExtractController } from './controllers/pdf-expense-invoice-extract.controller';
import { PdfExpenseInvoiceExtractorService } from './services/pdf-expense-invoice-extractor.service';
import { PdfExpensePaymentExtractController } from './controllers/pdf-expense-payment-extract.controller';
import { PdfExpensePaymentExtractorService } from './services/pdf-payment-extractor.service';
import { ArticleModule } from 'src/modules/article/article/article.module';
import { ArticleEntity } from 'src/modules/article/article/repositories/entities/article.entity';

@Module({
  imports: [
    forwardRef(() => ArticleModule),
    TypeOrmModule.forFeature([ArticleEntity]),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          return cb(null, `${randomName}${extname(file.originalname)}`);
        }
      }),
      limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
      },
      fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
          cb(null, true);
        } else {
          cb(new Error('Only PDF files are allowed'), false);
        }
      }
    })
  ],
  controllers: [OcrController, ArticleOcrController,PdfExtractController , ExpenseQuotationOcrController , PaymentOcrController , InvoiceOcrController , PdfExpenseQuotationExtractController,PdfExpenseInvoiceExtractController , PdfExpensePaymentExtractController],

  providers: [OcrService, ArticleOcrService, PdfArticleExtractorService , ExpenseQuotationOcrService,PaymentOcrService,InvoiceOcrService,PdfExpenseQuotationExtractorService,PdfExpenseInvoiceExtractorService , PdfExpensePaymentExtractorService],

  exports: [OcrService, ArticleOcrService , ExpenseQuotationOcrService,PaymentOcrService,InvoiceOcrService,PdfExpenseQuotationExtractorService,PdfExpenseInvoiceExtractorService , PdfExpensePaymentExtractorService],
})
export class OcrModule {}