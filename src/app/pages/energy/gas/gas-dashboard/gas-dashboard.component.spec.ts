import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GasDashboardComponent } from './gas-dashboard.component';

describe('GasDashboardComponent', () => {
  let component: GasDashboardComponent;
  let fixture: ComponentFixture<GasDashboardComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [GasDashboardComponent]
    });
    fixture = TestBed.createComponent(GasDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
