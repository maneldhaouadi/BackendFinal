import { Module, forwardRef } from '@nestjs/common';
import { OcrService } from './services/ocr.service';
import { OcrController } from './controllers/ocr.controller';
import { ArticleOcrController } from './controllers/articleOcrController';
import { ArticleOcrService } from './services/articleOcrService';
import { ArticleModule } from '../article/article.module'; // <-- importe le module

@Module({
  imports: [forwardRef(() => ArticleModule)], // 🔁 ici aussi
  controllers: [OcrController, ArticleOcrController],
  providers: [OcrService, ArticleOcrService],
  exports: [OcrService, ArticleOcrService],
})
export class OcrModule {}
