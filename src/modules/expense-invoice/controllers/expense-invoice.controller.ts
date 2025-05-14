import {
    Body,
    Controller,
    Delete,
    Get,
    Header,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    Request,
    Res,
    UseInterceptors,
  } from '@nestjs/common';
  import { ApiTags, ApiParam, ApiOperation, ApiResponse } from '@nestjs/swagger';
  import { ApiPaginatedResponse } from 'src/common/database/decorators/ApiPaginatedResponse';
  import { PageDto } from 'src/common/database/dtos/database.page.dto';
  import { IQueryObject } from 'src/common/database/interfaces/database-query-options.interface';
  import { LogInterceptor } from 'src/common/logger/decorators/logger.interceptor';
  import { EVENT_TYPE } from 'src/app/enums/logger/event-types.enum';
  import { LogEvent } from 'src/common/logger/decorators/log-event.decorator';
  import { Request as ExpressRequest } from 'express';
import { ExpenseResponseInvoiceDto } from '../dtos/expense-invoice.response.dto';
import { ExpenseCreateInvoiceDto } from '../dtos/expense-invoice-create.dto';
import { ExpenseDuplicateInvoiceDto } from '../dtos/expense-invoice.duplicate.dto';
import { ExpenseUpdateInvoiceDto } from '../dtos/expense-invoice.update.dto';
import { ExpenseInvoiceService } from '../services/expense-invoice.service';
import { TemplateService } from 'src/modules/template/services/template.service';
import { TemplateType } from 'src/modules/template/enums/TemplateType';
import { Response } from 'express';
 


  @ApiTags('expenseinvoice')
  @Controller({
    version: '1',
    path: '/expenseinvoice',
  })
  @UseInterceptors(LogInterceptor)
  export class ExpenseInvoiceController {
    constructor(private readonly invoiceService: ExpenseInvoiceService,
      private readonly templateService: TemplateService
    ) {}

    @Get('/all')
    async findAll(@Query() options: IQueryObject): Promise<ExpenseResponseInvoiceDto[]> {
      return this.invoiceService.findAll(options);
    }
  
    @Get('/list')
    @ApiPaginatedResponse(ExpenseResponseInvoiceDto)
    async findAllPaginated(
      @Query() query: IQueryObject,
    ): Promise<PageDto<ExpenseResponseInvoiceDto>> {
      return this.invoiceService.findAllPaginated(query);
    }
  

  
    @Get('/:id')
    @ApiParam({
      name: 'id',
      type: 'number',
      required: true,
    })
    async findOneById(
      @Param('id') id: number,
      @Query() query: IQueryObject,
    ): Promise<ExpenseResponseInvoiceDto> {
      query.filter
        ? (query.filter += `,id||$eq||${id}`)
        : (query.filter = `id||$eq||${id}`);
      return this.invoiceService.findOneByCondition(query);
    }
  
  
    @Post('')
    @LogEvent(EVENT_TYPE.BUYING_INVOICE_CREATED)
    async save(
      @Body() createInvoiceDto: ExpenseCreateInvoiceDto,
      @Request() req: ExpressRequest,
    ): Promise<ExpenseResponseInvoiceDto> {
      const invoice = await this.invoiceService.save(createInvoiceDto);
      req.logInfo = { id: invoice.id };
      return invoice;
    }
  
    @Post('/duplicate')
    @LogEvent(EVENT_TYPE.BUYING_INVOICE_DUPLICATED)
    async duplicate(
      @Body() duplicateInvoiceDto: ExpenseDuplicateInvoiceDto,
      @Request() req: ExpressRequest,
    ): Promise<ExpenseResponseInvoiceDto> {
      const invoice = await this.invoiceService.duplicate(duplicateInvoiceDto);
      req.logInfo = { id: duplicateInvoiceDto.id, duplicateId: invoice.id };
      return invoice;
    }
  
    @ApiParam({
      name: 'id',
      type: 'number',
      required: true,
    })
  
  
    @ApiParam({
      name: 'id',
      type: 'number',
      required: true,
    })
    @Put('/:id')
    @LogEvent(EVENT_TYPE.BUYING_INVOICE_UPDATED)
    async update(
      @Param('id') id: number,
      @Body() updateInvoiceDto: ExpenseUpdateInvoiceDto,
      @Request() req: ExpressRequest,
    ): Promise<ExpenseResponseInvoiceDto> {
      req.logInfo = { id };
      return this.invoiceService.update(id, updateInvoiceDto);
    }
  
    @ApiParam({
      name: 'id',
      type: 'number',
      required: true,
    })
    @Delete('/:id')
    @LogEvent(EVENT_TYPE.BUYING_INVOICE_DELETED)
    async delete(
      @Param('id') id: number,
      @Request() req: ExpressRequest,
    ): Promise<ExpenseResponseInvoiceDto> {
      req.logInfo = { id };
      return this.invoiceService.softDelete(id);
    }

    @Delete(':id/pdf')
    async deletePdfFile(@Param('id') id: number): Promise<void> {
      await this.invoiceService.deletePdfFile(id);
    }
    @ApiParam({
      name: 'id',
      type: 'number',
      required: true,
    }) 
    @Put('/:id/update-status-if-expired')
    @LogEvent(EVENT_TYPE.BUYING_INVOICE_UPDATED)
    async updateInvoiceStatusIfExpired(
      @Param('id') id: number,
      @Request() req: ExpressRequest,
    ): Promise<ExpenseResponseInvoiceDto> {
      req.logInfo = { id };
      return this.invoiceService.updateInvoiceStatusIfExpired(id);
    }

    @Get(':id/export-pdf')
@Header('Content-Type', 'application/pdf')
async exportInvoicePdf(
  @Res() res: Response,  // <-- Paramètre obligatoire en premier
  @Param('id', ParseIntPipe) id: number,  // <-- Paramètre obligatoire
  @Query('templateId') templateId?: number  // <-- Paramètre optionnel en dernier
): Promise<void> {
  try {
    const pdfBuffer = await this.invoiceService.generateInvoicePdf(id, templateId);
    
    // Définir les headers manuellement
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=facture-${id}.pdf`);
    
    // Envoyer le buffer
    res.send(pdfBuffer);
  } catch (error) {
    // Logger l'erreur
    
    // Retourner une réponse d'erreur appropriée
    res.status(500).json({
      statusCode: 500,
      message: 'Échec de la génération du PDF',
      error: error.message
    });
  }
}

@Get('/unpaid')
async findUnpaidByFirm(
  @Query('firmId') firmId: number
): Promise<ExpenseResponseInvoiceDto[]> {
  return this.invoiceService.findUnpaidByFirm(firmId);
}

@Get('/check-sequential/:sequentialNumber')
async checkSequentialNumber(
    @Param('sequentialNumber') sequentialNumber: string
): Promise<{ exists: boolean }> {
    const exists = await this.invoiceService.checkSequentialNumberExists(sequentialNumber);
    return { exists };
}


}

 