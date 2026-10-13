#import "Zeotap.h"

// The Swift half of this pod, exposed to Objective-C. CocoaPods names the
// generated interface header after the product module.
#if __has_include(<ZeotapReactNative/ZeotapReactNative-Swift.h>)
#import <ZeotapReactNative/ZeotapReactNative-Swift.h>
#else
#import "ZeotapReactNative-Swift.h"
#endif

@implementation Zeotap {
  ZeotapImpl *_impl;
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE(Zeotap)

- (instancetype)init {
  if (self = [super init]) {
    _impl = [ZeotapImpl new];
    __weak __typeof(self) weakSelf = self;
    // The Swift impl knows nothing about RCTEventEmitter; it just calls this.
    _impl.emitEvent = ^(NSDictionary *payload) {
      __strong __typeof(weakSelf) strongSelf = weakSelf;
      if (strongSelf && strongSelf->_hasListeners) {
        [strongSelf sendEventWithName:@"ZeotapEvent" body:payload];
      }
    };
  }
  return self;
}

/**
 * NO. The SDK owns its own serial queue and nothing in this module touches
 * UIKit, so forcing main-queue setup would block app startup for no reason —
 * which RN warns about loudly and which the legacy bridge did by default.
 */
+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (NSArray<NSString *> *)supportedEvents {
  // One event carrying `{type, message, code?}`; the JS layer fans it out to the
  // `error` / `debug` listeners. One native event keeps the bridge surface small
  // and means a new event type needs no native change.
  return @[ @"ZeotapEvent" ];
}

- (void)startObserving {
  _hasListeners = YES;
}

- (void)stopObserving {
  _hasListeners = NO;
}

#pragma mark - Spec methods

RCT_EXPORT_METHOD(configure
                  : (NSString *)writeKey options
                  : (NSDictionary *)options resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl configureWithWriteKey:writeKey
                       options:options
                       resolve:resolve
                        reject:^(NSString *code, NSString *message) {
                          reject(code, message, nil);
                        }];
}

RCT_EXPORT_METHOD(track
                  : (NSString *)event properties
                  : (NSDictionary *)properties resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl trackWithEvent:event
             properties:properties
                resolve:resolve
                 reject:^(NSString *code, NSString *message) {
                   reject(code, message, nil);
                 }];
}

RCT_EXPORT_METHOD(screen
                  : (NSString *)name category
                  : (NSString *)category properties
                  : (NSDictionary *)properties resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl screenWithName:name
               category:category
             properties:properties
                resolve:resolve
                 reject:^(NSString *code, NSString *message) {
                   reject(code, message, nil);
                 }];
}

RCT_EXPORT_METHOD(identify
                  : (NSString *)userId traits
                  : (NSDictionary *)traits resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl identifyWithUserId:userId
                     traits:traits
                    resolve:resolve
                     reject:^(NSString *code, NSString *message) {
                       reject(code, message, nil);
                     }];
}

RCT_EXPORT_METHOD(group
                  : (NSString *)groupId traits
                  : (NSDictionary *)traits resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl groupWithGroupId:groupId
                  traits:traits
                 resolve:resolve
                  reject:^(NSString *code, NSString *message) {
                    reject(code, message, nil);
                  }];
}

RCT_EXPORT_METHOD(alias
                  : (NSString *)newId previousId
                  : (NSString *)previousId resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl aliasWithNewId:newId
            previousId:previousId
               resolve:resolve
                reject:^(NSString *code, NSString *message) {
                  reject(code, message, nil);
                }];
}

RCT_EXPORT_METHOD(setConsent
                  : (NSDictionary *)input resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl setConsentWithInput:input
                    resolve:resolve
                     reject:^(NSString *code, NSString *message) {
                       reject(code, message, nil);
                     }];
}

RCT_EXPORT_METHOD(getConsentState
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl getConsentStateWithResolve:resolve
                            reject:^(NSString *code, NSString *message) {
                              reject(code, message, nil);
                            }];
}

RCT_EXPORT_METHOD(setUserIdentities
                  : (NSDictionary *)identities hashed
                  : (BOOL)hashed resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl setUserIdentitiesWithIdentities:identities
                                 hashed:hashed
                                resolve:resolve
                                 reject:^(NSString *code, NSString *message) {
                                   reject(code, message, nil);
                                 }];
}

RCT_EXPORT_METHOD(unsetUserIdentities
                  : (NSArray *)keys resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl unsetUserIdentitiesWithKeys:keys
                            resolve:resolve
                             reject:^(NSString *code, NSString *message) {
                               reject(code, message, nil);
                             }];
}

RCT_EXPORT_METHOD(getIdentity
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl getIdentityWithResolve:resolve
                        reject:^(NSString *code, NSString *message) {
                          reject(code, message, nil);
                        }];
}

RCT_EXPORT_METHOD(reset
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl resetWithResolve:resolve
                  reject:^(NSString *code, NSString *message) {
                    reject(code, message, nil);
                  }];
}

RCT_EXPORT_METHOD(flush
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl flushWithResolve:resolve
                  reject:^(NSString *code, NSString *message) {
                    reject(code, message, nil);
                  }];
}

RCT_EXPORT_METHOD(setAdvertisingIdIOS
                  : (NSString *)idfa trackingAuthorized
                  : (BOOL)trackingAuthorized resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject) {
  [_impl setAdvertisingIdWithIdfa:idfa
              trackingAuthorized:trackingAuthorized
                         resolve:resolve
                          reject:^(NSString *code, NSString *message) {
                            reject(code, message, nil);
                          }];
}

#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeZeotapSpecJSI>(params);
}
#endif

@end
