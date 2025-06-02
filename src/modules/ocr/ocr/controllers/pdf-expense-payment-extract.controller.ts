// src/modules/expense-quotation/controllers/pdf-expense-payment-extract.controller.ts
import { Controller, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PdfExpensePaymentExtractorService } from '../services/pdf-payment-extractor.service';

@Controller('expense-payment/pdf-extract')
export class PdfExpensePaymentExtractController {
  constructor(private readonly pdfService: PdfExpensePaymentExtractorService) {}

  @Post('structured')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!file.originalname.match(/\.(pdf)$/i)) {
        return cb(new BadRequestException('Only PDF files allowed'), false);
      }
      cb(null, true);
    }
  }))
  async extractStructured(@UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('Invalid PDF file');
    }
    return this.pdfService.extractStructuredData(file.buffer, file.originalname);
  }
}