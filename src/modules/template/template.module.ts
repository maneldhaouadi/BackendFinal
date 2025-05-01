import { Module } from '@nestjs/common';
import { TemplateService } from './services/template.service';
import { TemplateRepositoryModule } from './repositories/template.repository.module';
import { PdfModule } from 'src/common/pdf/pdf.module';

@Module({
  controllers: [],
  providers: [TemplateService],
  exports: [TemplateService],
  imports: [TemplateRepositoryModule,PdfModule],
})
export class TemplateModule {}