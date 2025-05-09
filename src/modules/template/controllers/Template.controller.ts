import { Controller, Get, Query, ParseEnumPipe, NotFoundException, Body, Post, Param, ParseIntPipe, Put, Delete, Res, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { TemplateService } from '../services/template.service';
import { ApiTags, ApiOperation, ApiResponse, ApiProduces } from '@nestjs/swagger';
import { Template } from '../repositories/entities/template.entity';
import { TemplateType } from '../enums/TemplateType';
import { CreateTemplateDto } from '../dtos/create-template.dto';
import { UpdateTemplateDto } from '../dtos/update-template.dto';
import { Response } from 'express'; // Instead of generic Response
import { ExpenseInvoiceService } from 'src/modules/expense-invoice/services/expense-invoice.service';
import { ExpensQuotationService } from 'src/modules/expense_quotation/services/expensquotation.service';
import { PaymentService } from 'src/modules/payment/services/payment.service';
import { ExpensePaymentService } from 'src/modules/expense-payment/services/expense-payment.service';

@ApiTags('Templates')
@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService,
    private readonly invoiceService:ExpenseInvoiceService,
    private readonly quotationService:ExpensQuotationService,
    private readonly paymentService:ExpensePaymentService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Récupérer tous les templates actifs' })
  @ApiResponse({ 
    status: 200, 
    description: 'Liste des templates retournée avec succès',
    type: [Template] 
  })
  async getAllTemplates(): Promise<Template[]> {
    return this.templateService.getAllTemplates();
  }

  @Get('by-type')
  @ApiOperation({ summary: 'Filtrer les templates par type' })
  @ApiResponse({ 
    status: 200, 
    description: 'Templates filtrés par type',
    type: [Template] 
  })
  async getTemplatesByType(
    @Query('type', new ParseEnumPipe(TemplateType)) type: TemplateType
  ): Promise<Template[]> {
    return this.templateService.getTemplatesByType(type);
  }

  @Get('default')
  @ApiOperation({ summary: 'Récupérer le template par défaut pour un type' })
  @ApiResponse({ 
    status: 200, 
    description: 'Template par défaut trouvé',
    type: Template 
  })
  async getDefaultTemplate(
    @Query('type', new ParseEnumPipe(TemplateType)) type: TemplateType
  ): Promise<Template> {
    const template = await this.templateService.getDefaultTemplate(type);
    if (!template) {
      throw new NotFoundException(`Aucun template par défaut trouvé pour le type ${type}`);
    }
    return template;
  }
  @Post()
@ApiOperation({ summary: 'Créer un nouveau template' })
@ApiResponse({ 
    status: 201, 
    description: 'Template créé avec succès',
    type: Template 
})
@ApiResponse({ 
    status: 400, 
    description: 'Un template avec ce nom existe déjà' 
})
async createTemplate(
    @Body() createTemplateDto: CreateTemplateDto
): Promise<Template> {
    try {
        return await this.templateService.createTemplate(createTemplateDto);
    } catch (error) {
        if (error.message === 'Un template avec ce nom existe déjà') {
            throw new BadRequestException(error.message);
        }
        throw error;
    }
}

  @Put(':id')
@ApiOperation({ summary: 'Mettre à jour un template' })
@ApiResponse({ 
    status: 200, 
    description: 'Template mis à jour avec succès',
    type: Template 
})
async updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateTemplateDto: UpdateTemplateDto
): Promise<Template> {
    return this.templateService.updateTemplate(id, updateTemplateDto);
}

@Delete(':id')
@ApiOperation({ summary: 'Supprimer un template (soft delete)' })
@ApiResponse({ 
    status: 200, 
    description: 'Template supprimé avec succès' 
})
@ApiResponse({ 
    status: 403, 
    description: 'Suppression interdite (isDeletionRestricted)' 
})
async deleteTemplate(
    @Param('id', ParseIntPipe) id: number
): Promise<void> {
    return this.templateService.deleteTemplate(id);
}

@Get(':id')
  @ApiOperation({ summary: 'Récupérer un template par son ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Template trouvé',
    type: Template 
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Template non trouvé' 
  })
  async getTemplateById(
    @Param('id', ParseIntPipe) id: number
  ): Promise<Template> {
    return this.templateService.getTemplateById(id);
  }

  @Get('invoices/:id/export-pdf')
@ApiOperation({ summary: 'Exporter une facture en PDF' })
@ApiProduces('application/pdf')
async exportInvoicePdf(
    @Param('id', ParseIntPipe) id: number,
    @Query('templateId') templateId: number,
    @Res() res: Response
) {
    const pdfBuffer = await this.invoiceService.generateInvoicePdf(id, templateId);
    
    res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=facture-${id}.pdf`,
        'Content-Length': pdfBuffer.length
    });
    
    res.send(pdfBuffer);
}

@Get('quotations/:id/export-pdf')
  @ApiOperation({ summary: 'Exporter un devis en PDF' })
  @ApiProduces('application/pdf')
  async exportQuotationPdf(
    @Param('id', ParseIntPipe) id: number,
    @Query('templateId') templateId: number,
    @Res() res: Response
  ) {
    const pdfBuffer = await this.quotationService.generateQuotationPdf(id, templateId);
    
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=devis-${id}.pdf`,
      'Content-Length': pdfBuffer.length
    });
    
    res.send(pdfBuffer);
  }

  @Get('payments/:id/export-pdf')
@ApiOperation({ summary: 'Exporter un paiement en PDF' })
@ApiProduces('application/pdf')
async exportPaymentPdf(
    @Param('id', ParseIntPipe) id: number,
    @Query('templateId') templateId: number,
    @Res() res: Response
) {
    try {
        const pdfBuffer = await this.paymentService.generatePaymentPdf(id, templateId);
        
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename=paiement-${id}.pdf`,
            'Content-Length': pdfBuffer.length
        });
        
        res.send(pdfBuffer);
    } catch (error) {
        if (error instanceof NotFoundException) {
            throw new NotFoundException(`Paiement avec ID ${id} non trouvé`);
        }
        throw new InternalServerErrorException('Échec de la génération du PDF de paiement');
    }
}

}