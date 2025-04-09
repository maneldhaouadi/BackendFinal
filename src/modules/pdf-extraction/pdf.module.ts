import { Module } from '@nestjs/common';
import { PdfExtractionService } from './services/pdf-extraction.service';

@Module({
    providers: [PdfExtractionService],
    exports: [PdfExtractionService]
})
export class PdfModule {}