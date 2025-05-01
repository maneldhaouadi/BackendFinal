import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ArticleModule } from '../article/article.module';
import { ArticleOcrController } from './controllers/articleOcrController';
import { ArticleOcrService } from './services/articleOcrService';
import { OcrController } from './controllers/ocr.controller';
import { OcrService } from './services/ocr.service';

@Module({
  imports: [
    forwardRef(() => ArticleModule),
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const randomName = Array(32).fill(null).map(() => Math.round(Math.random() * 16).toString(16)).join('');
          return cb(null, `${randomName}${extname(file.originalname)}`);
        }
      }),
      limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
      }
    })
  ],
  controllers: [OcrController, ArticleOcrController],
  providers: [OcrService, ArticleOcrService],
  exports: [OcrService, ArticleOcrService],
})
export class OcrModule {}