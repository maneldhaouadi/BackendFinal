import { Module } from '@nestjs/common';
import { OcrService } from './services/ocr.service';
import { OcrController } from './controllers/ocr.controller';

@Module({
  controllers: [OcrController],  // Ajoutez OcrController ici
  providers: [OcrService],       // Ajoutez OcrService ici
  exports: [OcrService],         // Exportez OcrService si nécessaire
  imports: [],                   // Vous pouvez importer d'autres modules si nécessaire
})
export class OcrModule {}